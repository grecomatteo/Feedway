import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  sendDigest,
  startDigests,
  type DigestSection,
  type Logger,
  type Mailer,
  type MailMessage,
  type NotificationChannel,
} from '@app/application'
import { instantToZoned, zonedToInstant } from '@app/domain'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, handlerDeps, recordingQueue } from '../../tests/accounts-jobs.js'
import {
  publishingWorld,
  readyPhoto,
  scheduledPost,
  testClock,
  type PublishingWorld,
} from '../../tests/publishing.js'
import { digestDeps } from './report.js'

// The morning digest (plan 08 Task 8): `report.daily` starts the digests due and each
// `report.digest` computes its sections in the person's scope of every agency, against the
// database. The test's morning is tomorrow at 8:00 in Rome, so the posts of «oggi» can still be
// scheduled through the panel; those of «ieri» are moved there afterwards.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

const ROME = 'Europe/Rome'
const DAY_MS = 86_400_000

/** Tomorrow's date in Rome, and an instant of it at a local time. */
const tomorrow = instantToZoned(new Date(Date.now() + DAY_MS), ROME).localDate
const atRome = (time: string, days = 0) =>
  new Date(zonedToInstant(tomorrow, time, ROME).instant.getTime() + days * DAY_MS)
const MORNING = atRome('08:00')

let a: PublishingWorld
let b: PublishingWorld
/** a member of one client in A and one in B */
let person: string
/** A's client that `person` does not see */
let hiddenClient: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()

  a = await publishingWorld(tdb, runtime)
  b = await publishingWorld(tdb, runtime)
  hiddenClient = await seed(tdb.runtimeUrl, (s) =>
    s.workspace(a.organizationId, { name: 'Pasticceria Nascosta' }),
  )
  await admin.query("update workspaces set name = 'Forno Luce' where id = $1", [a.workspaceId])
  await admin.query("update workspaces set name = 'Bottega Blu' where id = $1", [b.workspaceId])
  await runtime.uow.run({ organizationId: a.organizationId, userId: a.ownerId }, async (tx) => {
    await tx.workspaceAccounts.assign(a.organizationId, hiddenClient, a.accounts.instagram)
  })
  person = await seed(tdb.runtimeUrl, async (s) => {
    const id = await s.user({ name: 'Ada', email: 'ada@example.test' })
    await s.member(a.organizationId, id, 'member')
    await s.workspaceMember(a.organizationId, a.workspaceId, id, 'editor')
    await s.member(b.organizationId, id, 'member')
    await s.workspaceMember(b.organizationId, b.workspaceId, id, 'editor')
    return id
  })

  const photoA = await readyPhoto(tdb, runtime, admin, a)
  const photoB = await readyPhoto(tdb, runtime, admin, b)
  const onA = { mediaIds: [photoA], accounts: [a.accounts.instagram] }
  // yesterday 18:00, out
  const out = await scheduledPost(runtime, a, {
    ...onA,
    at: atRome('18:00'),
    caption: 'Pane caldo',
  })
  await admin.query("update posts set status = 'published', scheduled_at = $2 where id = $1", [
    out.postId,
    atRome('18:00', -1),
  ])
  // out at 18:21 after «Riprova»: the digest says when it went out (D-131.5)
  await admin.query(
    "update post_targets set status = 'published', published_at = $2 where post_id = $1",
    [out.postId, atRome('18:21', -1)],
  )
  // yesterday 12:00, not out
  const failed = await scheduledPost(runtime, a, { ...onA, at: atRome('19:00'), caption: 'Torta' })
  await admin.query("update posts set status = 'failed', scheduled_at = $2 where id = $1", [
    failed.postId,
    atRome('12:00', -1),
  ])
  // today 18:30 on B
  await scheduledPost(runtime, b, {
    mediaIds: [photoB],
    accounts: [b.accounts.instagram],
    at: atRome('18:30'),
    caption: 'Biscotti blu',
  })
  // today 11:00 on A's client the person does not see
  const hidden = { ...a, workspaceId: hiddenClient }
  await scheduledPost(runtime, hidden, {
    mediaIds: [await readyPhoto(tdb, runtime, admin, hidden)],
    accounts: [a.accounts.instagram],
    at: atRome('11:00'),
    caption: 'Segreto della casa',
  })
}, 240_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

function mailbox(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return {
    sent,
    isConfigured: () => Promise.resolve(true),
    send(message) {
      sent.push(message)
      return Promise.resolve('sent')
    },
  }
}

function capturingLogger(): Logger & { errors: string[] } {
  const errors: string[] = []
  const logger: Logger & { errors: string[] } = {
    errors,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (_obj, msg) => errors.push(msg ?? ''),
    child: () => logger,
  }
  return logger
}

function harness(
  opts: { at?: Date; sections?: (s: readonly DigestSection[]) => DigestSection[] } = {},
) {
  const mail = mailbox()
  const logger = capturingLogger()
  const queue = recordingQueue()
  const clock = testClock(opts.at ?? MORNING)
  const base = { ...handlerDeps(runtime, queue), mailer: mail, clock, logger }
  const deps = digestDeps(base)
  return {
    mail,
    logger,
    queue,
    clock,
    base,
    deps: opts.sections ? { ...deps, sections: opts.sections(deps.sections) } : deps,
  }
}

const job = (userId: string) => ({ userId, date: tomorrow, dueAt: MORNING.toISOString() })

test('report.daily starts the digest of who is due now, keyed by person and day', async () => {
  const before = harness({ at: atRome('07:59') })
  await startDigests({ ...before.base, lock: before.base.media.lock, defaultTimezone: ROME })
  expect(before.queue.sent.filter((j) => (j.data as { userId: string }).userId === person)).toEqual(
    [],
  )

  const h = harness()
  const report = await startDigests({ ...h.base, lock: h.base.media.lock, defaultTimezone: ROME })
  expect(report.ran).toBe(true)
  const mine = h.queue.sent.filter((j) => (j.data as { userId: string }).userId === person)
  expect(mine).toEqual([
    {
      name: 'report.digest',
      data: { userId: person, date: tomorrow, dueAt: MORNING.toISOString() },
      opts: { dedupeKey: `${person}:${tomorrow}` },
    },
  ])
})

test('a restarted report.daily does not queue the same digest twice', async () => {
  const sendOnce = () =>
    runtime.queue.send('report.digest', job(person), { dedupeKey: `${person}:${tomorrow}` })
  expect(await sendOnce()).not.toBeNull()
  expect(await sendOnce()).toBeNull()
})

test('a person who chose another time, or turned the digest off, is not started at 8:00', async () => {
  const late = await seed(tdb.runtimeUrl, async (s) => {
    const id = await s.user()
    await s.member(a.organizationId, id, 'member')
    return id
  })
  await admin.query(
    "insert into notification_settings (user_id, digest_time) values ($1, '09:30')",
    [late],
  )
  const h = harness()
  await startDigests({ ...h.base, lock: h.base.media.lock, defaultTimezone: ROME })
  expect(h.queue.sent.some((j) => (j.data as { userId: string }).userId === late)).toBe(false)
  await admin.query('update notification_settings set digest_time = $2 where user_id = $1', [
    late,
    '08:00',
  ])
  await admin.query('update notification_settings set digest_enabled = false where user_id = $1', [
    late,
  ])
  await startDigests({ ...h.base, lock: h.base.media.lock, defaultTimezone: ROME })
  expect(h.queue.sent.some((j) => (j.data as { userId: string }).userId === late)).toBe(false)
})

test('two runs at once: the second finds the lock taken and sends nothing', async () => {
  const h = harness()
  const deps = { ...h.base, lock: h.base.media.lock, defaultTimezone: ROME }
  const [first, second] = await Promise.all([startDigests(deps), startDigests(deps)])
  expect([first.ran, second.ran].sort()).toEqual([false, true])
})

test('a person in two agencies gets each agency’s digest, with only what they see there', async () => {
  const h = harness()
  const report = await sendDigest(h.deps, job(person))
  expect(report).toMatchObject({ outcome: 'done', agencies: 2, sent: 2, failed: 0 })
  expect(h.mail.sent.map((m) => m.to)).toEqual(['ada@example.test', 'ada@example.test'])
  const ofA = h.mail.sent.find((m) => m.text.includes('Forno Luce'))?.text ?? ''
  const ofB = h.mail.sent.find((m) => m.text.includes('Bottega Blu'))?.text ?? ''
  expect(ofA).toContain('Ieri è uscito un post')
  expect(ofA).toContain('18:21 · Forno Luce · «Pane caldo»')
  expect(ofA).toContain('Un post da sistemare')
  expect(ofA).toContain('Forno Luce · «Torta»: non è uscito')
  // the client the person does not see is never read
  expect(ofA).not.toContain('Segreto della casa')
  expect(ofA).not.toContain('Oggi esce')
  expect(ofB).toContain('Oggi esce un post')
  expect(ofB).toContain('18:30 · Bottega Blu · «Biscotti blu»')
  expect(ofB).not.toContain('Pane caldo')
  // a member is not told of the accounts
  expect(ofA).not.toContain('account e Meta')
  expect(h.mail.sent[0]?.subject).toMatch(/^Il riepilogo di /)
})

/** A Telegram that reaches everyone and keeps what it is given. */
function fakeTelegram() {
  const sent: { userId: string; title: string }[] = []
  const channel: NotificationChannel = {
    name: 'telegram',
    unavailable: '',
    isAvailable: () => Promise.resolve(true),
    send(recipient, message) {
      sent.push({ userId: recipient.userId, title: message.title })
      return Promise.resolve({ outcome: 'sent' })
    },
  }
  return { sent, channel }
}

test('the digest goes only on the channels the person chose', async () => {
  const telegram = fakeTelegram()
  const h = harness()
  const deps = { ...h.deps, channels: [...h.deps.channels, telegram.channel] }
  // nothing chosen: email and Telegram
  expect(await sendDigest(deps, job(person))).toMatchObject({ agencies: 2, sent: 4 })
  expect(h.mail.sent).toHaveLength(2)
  expect(telegram.sent).toHaveLength(2)

  await admin.query(
    "insert into notification_settings (user_id, digest_channels) values ($1, '{telegram}')",
    [person],
  )
  try {
    h.mail.sent.length = 0
    telegram.sent.length = 0
    expect(await sendDigest(deps, job(person))).toMatchObject({ agencies: 2, sent: 2, failed: 0 })
    expect(h.mail.sent).toEqual([])
    expect(telegram.sent.map((m) => m.userId)).toEqual([person, person])
  } finally {
    await admin.query('delete from notification_settings where user_id = $1', [person])
  }
})

test('the Owner sees every client and the accounts to fix', async () => {
  await admin.query("update social_accounts set health = 'error' where id = $1", [
    a.accounts.facebook,
  ])
  const h = harness()
  await sendDigest(h.deps, job(a.ownerId))
  const [email] = h.mail.sent
  expect(h.mail.sent).toHaveLength(1)
  expect(email?.text).toContain('Oggi esce un post')
  expect(email?.text).toContain('11:00 · Pasticceria Nascosta · «Segreto della casa»')
  expect(email?.text).toContain('Una cosa da sistemare su account e Meta')
  expect(email?.text).toMatch(/: non può pubblicare/)
  await admin.query("update social_accounts set health = 'ok' where id = $1", [a.accounts.facebook])
})

test('a section that fails leaves the others, and goes to the log', async () => {
  const h = harness({
    sections: (real) => [
      {
        id: 'broken',
        order: 0,
        // a query Postgres refuses: the transaction it ran in is aborted
        build: async (tx, ctx) => {
          await tx.posts.find({ organizationId: ctx.organizationId, workspaceId: 'x' }, 'y')
          return null
        },
      },
      ...real,
    ],
  })
  const report = await sendDigest(h.deps, job(person))
  expect(report).toMatchObject({ outcome: 'done', sent: 2, sectionErrors: 2 })
  expect(h.logger.errors).toEqual(['digest section failed', 'digest section failed'])
  expect(h.mail.sent.some((m) => m.text.includes('«Pane caldo»'))).toBe(true)
})

test('a section reads only the agency of its scope', async () => {
  const h = harness({
    sections: (real) => [
      {
        id: 'other-agency',
        order: 0,
        build: async (tx) => {
          // a section that asks for another agency's posts finds nothing
          const other = await tx.posts.listInPeriod(b.organizationId, [b.workspaceId], {
            from: new Date(0),
            to: new Date(8.64e15),
            statuses: ['scheduled'],
            limit: 10,
          })
          return { title: 'Fuori ambito', lines: other.map((p) => p.id), more: 0 }
        },
      },
      ...real,
    ],
  })
  await sendDigest(h.deps, job(person))
  const ofA = h.mail.sent.find((m) => m.text.includes('Forno Luce'))?.text ?? ''
  // in A's scope, B's posts are not there (RLS): the section has no lines and is left out
  expect(ofA).not.toContain('Fuori ambito')
})

test('a digest with nothing to say is not sent', async () => {
  const quiet = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const id = await s.user()
    await s.member(org, id, 'owner')
    return id
  })
  const h = harness()
  expect(await sendDigest(h.deps, job(quiet))).toMatchObject({
    outcome: 'done',
    agencies: 0,
    sent: 0,
  })
  expect(h.mail.sent).toEqual([])
})

test('turned off, gone or too late: nothing is sent', async () => {
  const off = await seed(tdb.runtimeUrl, async (s) => {
    const id = await s.user()
    await s.member(a.organizationId, id, 'admin')
    return id
  })
  await admin.query(
    'insert into notification_settings (user_id, digest_enabled) values ($1, false)',
    [off],
  )
  const h = harness()
  expect(await sendDigest(h.deps, job(off))).toEqual({ outcome: 'skipped', reason: 'off' })
  await admin.query("update users set status = 'disabled' where id = $1", [off])
  expect(await sendDigest(h.deps, job(off))).toEqual({ outcome: 'skipped', reason: 'gone' })
  h.clock.set(atRome('08:00', 1))
  expect(await sendDigest(h.deps, job(person))).toEqual({ outcome: 'skipped', reason: 'late' })
  expect(h.mail.sent).toEqual([])
})

/** The status changes only in the system scope. */
async function setStatus(organizationId: string, status: 'active' | 'suspended') {
  await admin.query("select set_config('app.scope', 'system', false)")
  await admin.query(
    `update organizations set status = $2::text,
       suspended_at = case when $2::text = 'suspended' then now() end where id = $1`,
    [organizationId, status],
  )
  await admin.query("select set_config('app.scope', '', false)")
}

test('a suspended agency is left out of the digest', async () => {
  await setStatus(b.organizationId, 'suspended')
  try {
    const h = harness()
    expect(await sendDigest(h.deps, job(person))).toMatchObject({ agencies: 1, sent: 1 })
    expect(h.mail.sent[0]?.text).toContain('Forno Luce')
  } finally {
    await setStatus(b.organizationId, 'active')
  }
})

test('an agency that fails is logged, the others are sent once, and the job does not throw', async () => {
  const h = harness()
  const [email] = h.deps.channels
  if (!email) throw new Error('no email channel')
  const deps = {
    ...h.deps,
    channels: [
      {
        ...email,
        isAvailable: (
          tx: Parameters<typeof email.isAvailable>[0],
          r: { organizationId: string | null },
        ) =>
          r.organizationId === b.organizationId
            ? Promise.reject(new Error('database gone'))
            : email.isAvailable(tx, r as Parameters<typeof email.isAvailable>[1]),
        send: email.send.bind(email),
      },
    ],
  }
  expect(await sendDigest(deps, job(person))).toMatchObject({ sent: 1, failed: 1 })
  expect(h.mail.sent).toHaveLength(1)
  expect(h.logger.errors).toEqual(['digest of an agency failed'])
})

test('who left an agency, or was taken off its client, gets nothing of it', async () => {
  await admin.query(
    "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
    [b.organizationId, person],
  )
  await admin.query('delete from workspace_members where workspace_id = $1 and user_id = $2', [
    a.workspaceId,
    person,
  ])
  try {
    const h = harness()
    expect(await sendDigest(h.deps, job(person))).toMatchObject({ agencies: 0, sent: 0 })
    expect(h.mail.sent).toEqual([])
  } finally {
    await admin.query(
      "update organization_members set status = 'active' where organization_id = $1 and user_id = $2",
      [b.organizationId, person],
    )
    await admin.query(
      "insert into workspace_members (organization_id, workspace_id, user_id, role) values ($1, $2, $3, 'editor')",
      [a.organizationId, a.workspaceId, person],
    )
  }
})
