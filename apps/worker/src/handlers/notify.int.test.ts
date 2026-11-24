import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  MailSendError,
  deliverNotification,
  deliverPlatformNotification,
  dispatchNotifications,
  type DispatchDeps,
  type Mailer,
  type MailMessage,
} from '@app/application'
import type { OutboxEventType, OutboxPayload } from '@app/domain'
import { createUnitOfWork, type Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import {
  accountsRuntime,
  handlerDeps,
  recordingQueue,
  type QueuedJob,
} from '../../tests/accounts-jobs.js'
import {
  publishingWorld,
  readyPhoto,
  scheduledPost,
  targetsOf,
  testClock,
  type PublishingWorld,
} from '../../tests/publishing.js'
import { notifyDeps } from './notify.js'
import { targetPrepare } from './target-steps.js'

// The notifications from the outbox to the panel and the email (plan 08 Task 5): the dispatcher,
// the delivery with its groups and retries, a worker that falls halfway, who can no longer see.
// Against the database; the events of the publishing come from its jobs or are written as they
// would write them.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

const SECOND = 1000
const MINUTE = 60 * SECOND

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

/** A mailbox that can be made to fail, and is configured unless told otherwise. */
function mailbox(opts: { configured?: boolean } = {}) {
  const sent: MailMessage[] = []
  const failures: MailSendError[] = []
  const mailer: Mailer & { sent: MailMessage[]; failNext(e: MailSendError): void } = {
    sent,
    isConfigured: () => Promise.resolve(opts.configured ?? true),
    send(message) {
      const failure = failures.shift()
      if (failure) return Promise.reject(failure)
      sent.push(message)
      return Promise.resolve('sent')
    },
    failNext: (e) => failures.push(e),
  }
  return mailer
}

interface Harness {
  deps: DispatchDeps
  queue: ReturnType<typeof recordingQueue>
  mail: ReturnType<typeof mailbox>
  clock: ReturnType<typeof testClock>
}

function harness(opts: { configured?: boolean; start?: Date } = {}): Harness {
  const queue = recordingQueue()
  const mail = mailbox(opts)
  const clock = testClock(opts.start ?? new Date())
  const deps = notifyDeps({ ...handlerDeps(runtime, queue), mailer: mail, clock })
  return { deps, queue, mail, clock }
}

const deliveryJobs = (jobs: readonly QueuedJob[]) =>
  jobs.filter((j) => j.name === 'notify.deliver' || j.name === 'notify.deliver_platform')

/** Runs the delivery jobs sent so far, as pg-boss would at their time, and forgets them. */
async function runDeliveries(h: Harness): Promise<void> {
  const jobs = deliveryJobs(h.queue.sent)
  h.queue.sent.length = 0
  for (const job of jobs) {
    const data = job.data as Record<string, string>
    if (job.name === 'notify.deliver') await deliverNotification(h.deps, data)
    else await deliverPlatformNotification(h.deps, data)
  }
}

/** Dispatch, then the deliveries once their group's minute has passed. */
async function dispatchAndDeliver(h: Harness): Promise<void> {
  await dispatchNotifications(h.deps)
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  await runDeliveries(h)
}

async function record(
  organizationId: string | null,
  type: OutboxEventType,
  payload: OutboxPayload,
): Promise<void> {
  await runtime.uow.runAsSystem('test: an event', async (tx) => {
    await tx.outbox.record({ organizationId, type, payload })
  })
}

interface DeliveryRow {
  user_id: string
  channel: string
  status: string
  attempts: number
  error: string | null
  kind: string
}

async function deliveriesOf(userId: string): Promise<DeliveryRow[]> {
  return (
    await admin.query<DeliveryRow>(
      `select user_id, channel, status, attempts, error, kind from notification_deliveries
        where user_id = $1 order by created_at, channel`,
      [userId],
    )
  ).rows
}

const notificationsOf = async (userId: string): Promise<unknown[]> =>
  (await admin.query('select * from notifications where user_id = $1', [userId])).rows as unknown[]

/** An agency with a client and a post scheduled by its Owner, and a Manager of the client. */
async function world(): Promise<
  PublishingWorld & { postId: string; targetId: string; generation: number; managerId: string }
> {
  const w = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, w)
  const { postId } = await scheduledPost(runtime, w, {
    at: new Date(Date.now() + 40 * MINUTE),
    mediaIds: [photo],
    accounts: [w.accounts.instagram],
    caption: 'Pane caldo alle 18\nseconda riga',
  })
  const [target] = await targetsOf(admin, postId)
  if (!target) throw new Error('no destination')
  const managerId = await seed(tdb.runtimeUrl, async (s) => {
    const user = await s.user({ name: 'Bea Manager' })
    await s.member(w.organizationId, user, 'member')
    await s.workspaceMember(w.organizationId, w.workspaceId, user, 'manager')
    return user
  })
  return { ...w, postId, targetId: target.id, generation: target.generation, managerId }
}

const failedPayload = (w: Awaited<ReturnType<typeof world>>, code = 'meta_error') => ({
  postId: w.postId,
  targetId: w.targetId,
  accountId: w.accounts.instagram,
  workspaceId: w.workspaceId,
  code,
})

test('a destination too late, from its job to the email of who scheduled and of the Manager', async () => {
  const w = await world()
  await admin.query("update posts set scheduled_at = now() - interval '20 minutes' where id = $1", [
    w.postId,
  ])
  await targetPrepare(
    {
      id: 'lavoro',
      data: { organizationId: w.organizationId, targetId: w.targetId, generation: w.generation },
    },
    handlerDeps(runtime, recordingQueue()),
  )
  const h = harness()
  await dispatchNotifications(h.deps)

  // the panel's row is the delivery; Telegram is not linked; the email waits for its group
  expect(await deliveriesOf(w.ownerId)).toEqual([
    expect.objectContaining({ channel: 'email', status: 'pending', kind: 'post.target_failed' }),
    expect.objectContaining({ channel: 'panel', status: 'sent' }),
    expect.objectContaining({
      channel: 'telegram',
      status: 'skipped',
      error: 'Telegram non collegato',
    }),
  ])
  const jobs = deliveryJobs(h.queue.sent)
  expect(jobs).toHaveLength(2)
  for (const job of jobs) {
    const opts = job.opts as { startAfter: Date; dedupeKey: string }
    // 60 seconds from the first notification (Scelta 7), keyed by the attempt (P1)
    expect(opts.startAfter.getTime() - h.clock.now().getTime()).toBe(60 * SECOND)
    expect(opts.dedupeKey).toMatch(/^[0-9a-f-]{36}:0:0$/)
  }
  // the event is marked: a second run writes nothing
  await dispatchNotifications(h.deps)
  expect(await notificationsOf(w.ownerId)).toHaveLength(1)

  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  await runDeliveries(h)
  expect(h.mail.sent.map((m) => m.subject)).toEqual([
    expect.stringMatching(/^Un post non è uscito su Account /),
    expect.stringMatching(/^Un post non è uscito su Account /),
  ])
  const [email] = h.mail.sent
  expect(email?.text).toContain('«Pane caldo alle 18»: L’ora era passata da troppo tempo')
  expect(email?.text).toContain(`/spazi/${w.workspaceId}/post/${w.postId}`)
  expect(email?.text).toContain('https://pannello.example.test/account')
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')?.status).toBe('sent')
  expect((await deliveriesOf(w.managerId)).find((d) => d.channel === 'email')?.status).toBe('sent')
})

test('every kind of event gets its words, read now, in the email', async () => {
  const w = await world()
  const platformAdmin = await seed(tdb.runtimeUrl, (s) => s.user({ name: 'Eva Piattaforma' }))
  await admin.query("update users set platform_role = 'admin' where id = $1", [platformAdmin])
  await admin.query("update account_connections set business_name = 'Forno Luce' where id = $1", [
    w.connectionId,
  ])
  const post = { postId: w.postId, workspaceId: w.workspaceId }
  const target = { ...post, targetId: w.targetId, accountId: w.accounts.instagram }
  const o = w.organizationId
  // every kind turned on everywhere (the «Tutto ovunque» of the tests, §12.3)
  await admin.query(
    `insert into notification_settings (user_id, everything_everywhere)
     values ($1, true), ($2, true), ($3, true)`,
    [w.ownerId, w.managerId, platformAdmin],
  )
  const events: [string | null, OutboxEventType, OutboxPayload][] = [
    [o, 'post.target_confirmed', { ...target, code: null }],
    [o, 'post.confirmed', post],
    [o, 'post.target_problem', { ...target, reason: 'not_found' }],
    [o, 'post.file_wont_publish', { ...target, code: 'media_copy_failed', when: 'before' }],
    [o, 'post.paused', { ...target, code: 'author_lost_permission' }],
    [o, 'account.quota_low', { accountId: w.accounts.instagram, left: 3, total: 50 }],
    [o, 'account.token_invalid', { connectionId: w.connectionId, status: 'expired' }],
    [
      o,
      'account.unhealthy',
      {
        accountId: w.accounts.facebook,
        connectionId: w.connectionId,
        health: 'error',
        problem: null,
      },
    ],
    [o, 'meta.reminder', { reminder: 'data_use_checkup', dueOn: '2026-12-03', daysLeft: 10 }],
    [null, 'system.backup_failed', {}],
  ]
  for (const [org, type, payload] of events) await record(org, type, payload)
  const h = harness()
  await dispatchAndDeliver(h)
  const subjects = h.mail.sent.map((m) => m.subject)
  expect(subjects).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^Pubblicato su Account /),
      'Post uscito su tutti gli account',
      expect.stringMatching(/^Un post uscito su Account .* ha un problema$/),
      expect.stringMatching(/^Un file del post non si può pubblicare su Account /),
      expect.stringMatching(/^Un post è in pausa su Account /),
      expect.stringMatching(/^Account .* ha quasi finito i post di Instagram$/),
      'Un collegamento con Meta non funziona più',
      expect.stringMatching(/^Account .* ha un problema$/),
      'Da sistemare su Meta',
      'Il backup non è riuscito',
    ]),
  )
  const bodyOf = (subject: string) =>
    h.mail.sent.find((m) => m.subject.startsWith(subject))?.text ?? ''
  expect(bodyOf('Un file del post')).toContain("sistemalo prima dell'ora")
  expect(bodyOf('Un collegamento')).toContain('Forno Luce: il token è scaduto')
  expect(bodyOf('Un collegamento')).toContain('/impostazioni/integrazioni/meta')
  expect(bodyOf('Da sistemare')).toContain('giovedì 3 dicembre 2026')
  expect(bodyOf('Il backup')).toContain('Controlla i log del backup')
  // the platform's went to its administrator only, through the system's job
  expect((await deliveriesOf(platformAdmin)).map((d) => [d.kind, d.channel, d.status])).toEqual([
    ['system.backup_failed', 'email', 'sent'],
    ['system.backup_failed', 'panel', 'sent'],
    ['system.backup_failed', 'telegram', 'skipped'],
  ])
})

test('30 destinations that fail in the same minute are one email per person', async () => {
  const w = await world()
  for (let i = 0; i < 30; i += 1)
    await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchAndDeliver(h)
  const mine = h.mail.sent.filter((m) => m.subject === '30 pubblicazioni non sono uscite')
  // one to who scheduled, one to the Manager
  expect(mine).toHaveLength(2)
  expect(mine[0]?.text).toContain('e altre 20')
  const emails = (await deliveriesOf(w.ownerId)).filter((d) => d.channel === 'email')
  expect(emails).toHaveLength(30)
  expect(emails.every((d) => d.status === 'sent')).toBe(true)
  // and the centre keeps one row per event
  expect(await notificationsOf(w.ownerId)).toHaveLength(30)
})

test('a worker that falls after the dispatch, before sending the jobs: the next run sends them', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  const fallen: DispatchDeps = {
    ...h.deps,
    queue: { send: () => Promise.reject(new Error('the process fell')) },
  }
  await dispatchNotifications(fallen)
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')?.status).toBe('pending')
  expect(deliveryJobs(h.queue.sent)).toHaveLength(0)
  // a minute later the sweep finds the deliveries due and sends their jobs
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  await dispatchNotifications(h.deps)
  await runDeliveries(h)
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(1)
})

test('a worker that falls between the send and its save repeats one email, not more', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchNotifications(h.deps)
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  const [job] = deliveryJobs(h.queue.sent).filter(
    (j) => (j.data as { recipientUserId: string }).recipientUserId === w.ownerId,
  )
  h.queue.sent.length = 0
  // the second transaction, the save, never comes
  let runs = 0
  const falling: DispatchDeps = {
    ...h.deps,
    uow: {
      ...h.deps.uow,
      run: (scope, fn) => {
        runs += 1
        return runs === 2
          ? Promise.reject(new Error('the process fell'))
          : h.deps.uow.run(scope, fn)
      },
    },
  }
  await expect(deliverNotification(falling, job?.data as Record<string, string>)).rejects.toThrow(
    'the process fell',
  )
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(1)
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')?.status).toBe('sending')
  // before the claim runs out nothing is sent again
  await dispatchNotifications(h.deps)
  await runDeliveries(h)
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(1)
  // after it, once more, and then it is sent
  h.clock.set(new Date(h.clock.now().getTime() + 6 * MINUTE))
  await dispatchNotifications(h.deps)
  await runDeliveries(h)
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(2)
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'sent',
    attempts: 1,
  })
  await dispatchNotifications(h.deps)
  await runDeliveries(h)
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(2)
})

test('a failed attempt is tried again with its own key, and after the last one it has failed', async () => {
  const w = await world()
  // only who scheduled: the Manager leaves the client
  await admin.query('delete from workspace_members where user_id = $1', [w.managerId])
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchNotifications(h.deps)
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  for (let i = 0; i < 4; i += 1) h.mail.failNext(new MailSendError('timeout'))
  const keys: string[] = []
  const gaps = [1, 5, 15]
  for (const gap of [0, ...gaps]) {
    h.clock.set(new Date(h.clock.now().getTime() + gap * MINUTE + SECOND))
    await dispatchNotifications(h.deps)
    keys.push(
      ...deliveryJobs(h.queue.sent)
        .filter((j) => (j.data as { recipientUserId: string }).recipientUserId === w.ownerId)
        .map((j) => (j.opts as { dedupeKey: string }).dedupeKey),
    )
    await runDeliveries(h)
  }
  // the same attempt sent twice is one job for pg-boss: the key is the same
  expect([...new Set(keys.map((k) => k.split(':').slice(1).join(':')))]).toEqual([
    '0:0',
    '1:0',
    '2:0',
    '3:0',
  ])
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'failed',
    attempts: 3,
    error: "Il server dell'email non ha risposto in tempo",
  })
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(0)
})

test('a Manager taken off the client before the send gets nothing outside the panel', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchNotifications(h.deps)
  await admin.query('delete from workspace_members where user_id = $1', [w.managerId])
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  await runDeliveries(h)
  expect((await deliveriesOf(w.managerId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'skipped',
    error: 'Non può più vedere questa notifica: il messaggio non parte',
  })
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.managerId))).toHaveLength(0)
  // an event after it does not reach them at all
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  await dispatchNotifications(h.deps)
  expect(await notificationsOf(w.managerId)).toHaveLength(1)
})

const everythingEverywhere = (...users: string[]) =>
  admin.query(
    `insert into notification_settings (user_id, everything_everywhere)
     select unnest($1::uuid[]), true
     on conflict (user_id) do update set everything_everywhere = true`,
    [users],
  )

test("a Manager taken off the account's clients gets nothing of its quota", async () => {
  const w = await world()
  await everythingEverywhere(w.managerId)
  await record(w.organizationId, 'account.quota_low', {
    accountId: w.accounts.instagram,
    left: 3,
    total: 50,
  })
  const h = harness()
  await dispatchNotifications(h.deps)
  expect((await deliveriesOf(w.managerId)).find((d) => d.channel === 'email')?.status).toBe(
    'pending',
  )
  await admin.query('delete from workspace_members where user_id = $1', [w.managerId])
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  await runDeliveries(h)
  expect((await deliveriesOf(w.managerId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'skipped',
    error: 'Non può più vedere questa notifica: il messaggio non parte',
  })
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.managerId))).toHaveLength(0)
  // the next event does not reach them at all
  await record(w.organizationId, 'account.quota_low', {
    accountId: w.accounts.instagram,
    left: 2,
    total: 50,
  })
  await dispatchNotifications(h.deps)
  expect(await notificationsOf(w.managerId)).toHaveLength(1)
})

test('an Admin made a member before the send no longer gets what is for the Admins', async () => {
  const w = await world()
  const adminId = await seed(tdb.runtimeUrl, async (s) => {
    const user = await s.user({ name: 'Ada Admin' })
    await s.member(w.organizationId, user, 'admin')
    return user
  })
  await everythingEverywhere(adminId)
  await record(w.organizationId, 'account.token_invalid', {
    connectionId: w.connectionId,
    status: 'expired',
  })
  const h = harness()
  await dispatchNotifications(h.deps)
  await admin.query(
    "update organization_members set role = 'member' where user_id = $1 and organization_id = $2",
    [adminId, w.organizationId],
  )
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  await runDeliveries(h)
  expect((await deliveriesOf(adminId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'skipped',
    error: 'Non può più vedere questa notifica: il messaggio non parte',
  })
  expect(h.mail.sent.filter((m) => m.to.startsWith(adminId))).toHaveLength(0)
})

test('a group whose process keeps falling stops at the last attempt', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchNotifications(h.deps)
  h.queue.sent.length = 0
  // the fourth claim ran out, like the three before it
  await admin.query(
    `update notification_deliveries
        set status = 'sending', attempts = 3, claimed_until = now() - interval '1 minute'
      where user_id = $1 and channel = 'email'`,
    [w.ownerId],
  )
  await dispatchNotifications(h.deps)
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'failed',
    attempts: 4,
    error: "L'invio non è riuscito",
  })
  expect(
    deliveryJobs(h.queue.sent).filter(
      (j) => (j.data as { recipientUserId: string }).recipientUserId === w.ownerId,
    ),
  ).toHaveLength(0)
})

test('two workers that start two jobs of one group together send one email', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  await record(w.organizationId, 'post.target_failed', failedPayload(w, 'other'))
  const h = harness()
  await dispatchNotifications(h.deps)
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  const jobs = deliveryJobs(h.queue.sent).filter(
    (j) => (j.data as { recipientUserId: string }).recipientUserId === w.ownerId,
  )
  expect(jobs).toHaveLength(2)
  h.queue.sent.length = 0
  await Promise.all(jobs.map((j) => deliverNotification(h.deps, j.data as Record<string, string>)))
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(1)
})

test('an event that cannot be read is set aside, and the others of its batch go out', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', {
    ...failedPayload(w),
    postId: 'not-a-uuid',
  })
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchNotifications(h.deps)
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from outbox_events where organization_id = $1 and dispatched_at is null',
    [w.organizationId],
  )
  expect(rows[0]?.n).toBe(0)
  expect(await notificationsOf(w.ownerId)).toHaveLength(1)
})

test('a disabled or anonymized person is not notified', async () => {
  const w = await world()
  await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
    w.managerId,
  ])
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  await dispatchNotifications(harness().deps)
  expect(await notificationsOf(w.managerId)).toHaveLength(0)
  expect(await notificationsOf(w.ownerId)).toHaveLength(1)
})

test('a suspended agency keeps its rows in the centre, and sends no email', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  // the status changes only in the system scope
  await admin.query("select set_config('app.scope', 'system', false)")
  await admin.query(
    "update organizations set status = 'suspended', suspended_at = now() where id = $1",
    [w.organizationId],
  )
  await admin.query("select set_config('app.scope', '', false)")
  const h = harness()
  await dispatchAndDeliver(h)
  expect(await deliveriesOf(w.ownerId)).toEqual([
    expect.objectContaining({
      channel: 'email',
      status: 'skipped',
      error: "L'agenzia è sospesa: il messaggio non parte",
    }),
    expect.objectContaining({ channel: 'panel', status: 'sent' }),
    expect.objectContaining({ channel: 'telegram', status: 'skipped' }),
  ])
  expect(h.mail.sent.filter((m) => m.to.startsWith(w.ownerId))).toHaveLength(0)
})

test('D-74: who scheduled gets the email of a file that will not go out, even with the email off', async () => {
  const w = await world()
  await admin.query(
    `insert into notification_prefs (user_id, kind, channels)
     values ($1, 'post.file_wont_publish', '{panel}'), ($2, 'post.file_wont_publish', '{panel}')`,
    [w.ownerId, w.managerId],
  )
  await record(w.organizationId, 'post.file_wont_publish', {
    ...failedPayload(w),
    code: null,
    when: 'at',
  })
  const h = harness()
  await dispatchAndDeliver(h)
  expect((await deliveriesOf(w.ownerId)).map((d) => d.channel)).toEqual(['email', 'panel'])
  expect((await deliveriesOf(w.managerId)).map((d) => d.channel)).toEqual(['panel'])
  const mine = h.mail.sent.filter((m) => m.to.startsWith(w.ownerId) || m.to.startsWith(w.managerId))
  expect(mine.map((m) => [m.to.slice(0, 36), m.subject])).toEqual([
    [w.ownerId, expect.stringMatching(/^Un file del post non si può pubblicare/)],
  ])
})

test('without SMTP the email is skipped with the reason', async () => {
  const w = await world()
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness({ configured: false })
  await dispatchNotifications(h.deps)
  expect((await deliveriesOf(w.ownerId)).find((d) => d.channel === 'email')).toMatchObject({
    status: 'skipped',
    error: 'Email non configurata sulla piattaforma',
  })
})

test('a post deleted since gives a short message without its text', async () => {
  const w = await world()
  // the post is gone: who scheduled it is not known any more, the client's Manager hears of it
  await record(w.organizationId, 'post.target_failed', {
    ...failedPayload(w),
    postId: randomUUID(),
  })
  const h = harness()
  await dispatchAndDeliver(h)
  expect(await notificationsOf(w.ownerId)).toHaveLength(0)
  const [email] = h.mail.sent.filter((m) => m.to.startsWith(w.managerId))
  expect(email?.text).toContain("Un post che non c'è più")
  expect(email?.text).not.toContain('Pane caldo')
  expect(email?.text).toContain(`/spazi/${w.workspaceId}/post`)
})

test('a post without text is named by its type and its first file, as in the panel (R7)', async () => {
  const w = await world()
  await admin.query("update posts set caption = '' where id = $1", [w.postId])
  await admin.query(
    `update media set original_name = 'IMG_0233.HEIC'
      where id = (select media_id from post_media where post_id = $1 limit 1)`,
    [w.postId],
  )
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  const h = harness()
  await dispatchAndDeliver(h)
  const [email] = h.mail.sent.filter((m) => m.to.startsWith(w.managerId))
  expect(email?.text).toContain('«Foto · IMG_0233»')
  expect(email?.text).not.toContain('post senza testo')
})

test('a commit that wrote an event wakes the dispatcher; one that wrote none does not', async () => {
  const w = await world()
  let woken = 0
  const uow = createUnitOfWork({
    db: runtime.db,
    ids: runtime.ids,
    logger: runtime.logger,
    afterEventsCommitted: () => {
      woken += 1
      return Promise.reject(new Error('the queue is down'))
    },
  })
  const scope = { organizationId: w.organizationId, userId: w.ownerId }
  await uow.run(scope, (tx) => tx.workspaces.findById(w.organizationId, w.workspaceId))
  expect(woken).toBe(0)
  // a failure of the hook is logged, never thrown: the use case has saved
  await uow.run(scope, (tx) =>
    tx.outbox.record({
      organizationId: w.organizationId,
      type: 'post.target_failed',
      payload: failedPayload(w),
    }),
  )
  expect(woken).toBe(1)
  // rolled back: nothing to wake for
  await expect(
    uow.run(scope, async (tx) => {
      await tx.outbox.record({
        organizationId: w.organizationId,
        type: 'post.target_failed',
        payload: failedPayload(w),
      })
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(woken).toBe(1)
})

test("the platform's job never sends a delivery of an agency, nor an agency's job one of the platform", async () => {
  const w = await world()
  const platformAdmin = await seed(tdb.runtimeUrl, (s) => s.user({ name: 'Eva Piattaforma' }))
  await admin.query("update users set platform_role = 'admin' where id = $1", [platformAdmin])
  await record(w.organizationId, 'post.target_failed', failedPayload(w))
  await record(null, 'system.backup_failed', {})
  const h = harness()
  await dispatchNotifications(h.deps)
  h.clock.set(new Date(h.clock.now().getTime() + 61 * SECOND))
  const jobs = deliveryJobs(h.queue.sent)
  const ofAgency = jobs.find((j) => j.name === 'notify.deliver')?.data as Record<string, string>
  const ofPlatform = jobs.find((j) => j.name === 'notify.deliver_platform')?.data as Record<
    string,
    string
  >
  expect(
    await deliverPlatformNotification(h.deps, {
      deliveryId: ofAgency.deliveryId,
      recipientUserId: ofAgency.recipientUserId,
    }),
  ).toEqual({ outcome: 'nothing' })
  expect(
    await deliverNotification(h.deps, { organizationId: w.organizationId, ...ofPlatform }),
  ).toEqual({ outcome: 'nothing' })
  expect(h.mail.sent).toHaveLength(0)
})
