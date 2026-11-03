import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  listMembers,
  runRetention,
  userAnonymizedHandlers,
  type JobPayloads,
  type JobQueue,
  type Logger,
  type RetentionDeps,
} from '@app/application'
import {
  createCredentialEraser,
  createMemoryMailer,
  createRuntime,
  createZipWriter,
  QUEUES,
} from '@app/infrastructure'
import type { Runtime } from '@app/infrastructure'
import { fixedClock, seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { createTranslate, loadItalianMessages } from '../i18n.js'
import type { JobHandlerDeps } from '../job-handler.js'
import { identityAnonymizationNotice } from './identity-retention.js'

const PANEL = new URL('https://pannello.example.test')
const DAY = 86_400_000
const days = (n: number) => n * DAY

let tdb: TestDatabase
let runtime: Runtime
let admin: pg.Client
let mediaRoot: string
let clock: ReturnType<typeof fixedClock>
const mailer = createMemoryMailer()
const warnings: string[] = []

type Notice = JobPayloads['identity.anonymization_notice']
const notices: Notice[] = []
const recording: Pick<JobQueue, 'send'> = {
  send(name, data) {
    if (name === 'identity.anonymization_notice') notices.push(data as Notice)
    return Promise.resolve(null)
  },
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  mediaRoot = await mkdtemp(join(tmpdir(), 'retention-'))
  runtime = await createRuntime(
    {
      nodeEnv: 'production',
      databaseUrl: tdb.runtimeUrl,
      encryptionKey: randomBytes(32),
      logLevel: 'error',
      mediaRoot,
    },
    'worker',
  )
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
})
afterAll(async () => {
  await admin.end()
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await rm(mediaRoot, { recursive: true, force: true })
  await tdb.stop()
})
beforeEach(() => {
  clock = fixedClock(new Date())
  warnings.length = 0
})

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (_obj, msg) => {
    warnings.push(msg ?? '')
  },
  error: () => undefined,
  child: () => logger,
}

const deps = (): RetentionDeps => ({
  uow: runtime.uow,
  clock,
  storage: runtime.storage,
  logger,
  queue: recording,
  auth: { deleteAllCredentials: createCredentialEraser({ db: runtime.db }) },
  onUserAnonymized: userAnonymizedHandlers(),
})

/** Every notice queued so far goes out, as the worker would send them. */
async function deliverNotices() {
  const handlerDeps: JobHandlerDeps = {
    logger,
    queue: recording,
    uow: runtime.uow,
    clock,
    ids: runtime.ids,
    storage: runtime.storage,
    credentials: { deleteAllCredentials: () => Promise.reject(new Error('not used')) },
    zip: createZipWriter(),
    mailer,
    signedTokens: runtime.signedTokens,
    translate: createTranslate(loadItalianMessages()),
    panel: { url: PANEL, productName: 'Feedway', defaultTimezone: 'Europe/Rome' },
  }
  for (const data of notices.splice(0))
    await identityAnonymizationNotice({ id: randomUUID(), data }, handlerDeps)
}
const mailsTo = (email: string) => mailer.sent.filter((m) => m.to === email)

/** An agency with its Owner and a member the platform disabled `daysAgo` days ago. */
async function agencyWithDisabled(daysAgo: number) {
  const ownerEmail = `owner-${randomUUID().slice(0, 8)}@example.test`
  const ids = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const owner = await s.user({ email: ownerEmail, name: 'Olga Owner' })
    const person = await s.user({ name: 'Paolo Prova' })
    await s.member(org, owner, 'owner')
    await s.member(org, person, 'member')
    return { org, owner, person }
  })
  await disableAt(ids.person, new Date(clock.now().getTime() - days(daysAgo)))
  return { ...ids, ownerEmail }
}

async function disableAt(userId: string, at: Date) {
  await admin.query(`update users set status = 'disabled', disabled_at = $2 where id = $1`, [
    userId,
    at,
  ])
}

async function enable(userId: string) {
  await admin.query(`update users set status = 'active', disabled_at = null where id = $1`, [
    userId,
  ])
}

async function anonymizedAt(userId: string) {
  const { rows } = await admin.query<{ anonymized_at: Date | null }>(
    'select anonymized_at from users where id = $1',
    [userId],
  )
  return rows[0]?.anonymized_at ?? null
}

test('expired sessions older than 30 days are removed, newer ones stay', async () => {
  const userId = await seed(tdb.runtimeUrl, (s) => s.user())
  for (const [token, ago] of [
    ['old', 31],
    ['recent', 29],
  ] as const)
    await admin.query(
      `insert into sessions (id, expires_at, token, user_id, updated_at)
       values ($1, $2, $3, $4, now())`,
      [randomUUID(), new Date(clock.now().getTime() - days(ago)), `${token}-${userId}`, userId],
    )
  await runRetention(deps())
  const { rows } = await admin.query<{ token: string }>(
    'select token from sessions where user_id = $1',
    [userId],
  )
  expect(rows.map((r) => r.token)).toEqual([`recent-${userId}`])
})

test('known devices unused for 12 months are removed', async () => {
  const userId = await seed(tdb.runtimeUrl, (s) => s.user())
  await admin.query(
    `insert into known_devices (user_id, device_hash, first_seen_at, last_seen_at)
     values ($1, '\\x01', $2, $2), ($1, '\\x02', $3, $3)`,
    [
      userId,
      new Date(clock.now().getTime() - days(366)),
      new Date(clock.now().getTime() - days(300)),
    ],
  )
  await runRetention(deps())
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from known_devices where user_id = $1',
    [userId],
  )
  expect(rows[0]?.n).toBe(1)
})

test('audit ips older than 90 days are shortened once', async () => {
  const [old, recent] = [randomUUID(), randomUUID()]
  await admin.query(
    `insert into audit_log (id, organization_id, actor_id, source, action, ip, created_at) values
       ($1, null, null, 'system', 'user.disabled', '93.41.12.7', now() - interval '91 days'),
       ($2, null, null, 'system', 'user.disabled', '10.1.2.3', now() - interval '1 day')`,
    [old, recent],
  )
  await runRetention(deps())
  await runRetention(deps())
  const { rows } = await admin.query<{ id: string; ip: string }>(
    'select id, host(ip) as ip from audit_log where id = any($1)',
    [[old, recent]],
  )
  expect(Object.fromEntries(rows.map((r) => [r.id, r.ip]))).toEqual({
    [old]: '93.41.12.0',
    [recent]: '10.1.2.3',
  })
})

test('expired exports lose their file, and stuck ones count as failed', async () => {
  const userId = await seed(tdb.runtimeUrl, (s) => s.user())
  const [expired, stuck] = [randomUUID(), randomUUID()]
  const key = `users/${userId}/exports/${expired}.zip`
  await runtime.storage.put(key, Buffer.from('zip'), { contentType: 'application/zip' })
  await admin.query(
    `insert into data_exports (id, user_id, status, storage_key, expires_at, updated_at) values
       ($1, $3, 'ready', $4, $5, now()),
       ($2, $3, 'running', null, null, $6)`,
    [
      expired,
      stuck,
      userId,
      key,
      new Date(clock.now().getTime() - 60_000),
      new Date(clock.now().getTime() - days(1) - 60_000),
    ],
  )
  await runRetention(deps())
  expect(await runtime.storage.list(`users/${userId}/`)).toEqual([])
  const { rows } = await admin.query<{ id: string; status: string }>(
    'select id, status from data_exports where user_id = $1',
    [userId],
  )
  expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
    [expired]: 'expired',
    [stuck]: 'failed',
  })
})

test('photo previews older than an hour are removed', async () => {
  const userId = await seed(tdb.runtimeUrl, (s) => s.user())
  const preview = `users/${userId}/avatar/staging/${randomUUID()}`
  const photo = `users/${userId}/avatar/abc.webp`
  for (const key of [preview, photo])
    await runtime.storage.put(key, Buffer.from('x'), { contentType: 'image/webp' })
  clock.advance(3600_000 + 60_000)
  await runRetention(deps())
  expect((await runtime.storage.list(`users/${userId}/`)).map((f) => f.key)).toEqual([photo])
})

test('disabled user: notice at 23 months, anonymization after 24 months and 30 days of notice', async () => {
  const { org, owner, person, ownerEmail } = await agencyWithDisabled(701)
  await runRetention(deps())
  await deliverNotices()
  const sent = mailsTo(ownerEmail)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.subject).toMatch(/Paolo Prova sarà anonimizzato/)
  expect(await anonymizedAt(person)).toBeNull()
  // the agency's user list says when
  const members = await listMembers(
    { uow: runtime.uow },
    {
      userId: owner,
      organizationId: org,
      orgRole: 'owner',
      platformRole: null,
      memberships: new Map(),
    },
  )
  expect(members.find((m) => m.id === person)?.anonymizationScheduledFor).not.toBeNull()

  clock.advance(days(31))
  await runRetention(deps())
  expect(await anonymizedAt(person)).not.toBeNull()
})

test('a re-enabled user is not anonymized', async () => {
  const { person } = await agencyWithDisabled(701)
  await runRetention(deps())
  await enable(person)
  clock.advance(days(31))
  await runRetention(deps())
  expect(await anonymizedAt(person)).toBeNull()
})

test('a notice from an earlier disabled period does not count', async () => {
  const { person, ownerEmail } = await agencyWithDisabled(701)
  await runRetention(deps())
  await deliverNotices()
  await enable(person)
  clock.advance(days(2))
  await disableAt(person, clock.now())
  clock.advance(days(731))
  await runRetention(deps())
  await deliverNotices()
  expect(await anonymizedAt(person)).toBeNull()
  expect(mailsTo(ownerEmail)).toHaveLength(2)
  clock.advance(days(31))
  await runRetention(deps())
  expect(await anonymizedAt(person)).not.toBeNull()
})

test('an owner or the platform admin is never anonymized automatically', async () => {
  const { org: orgB, owner: ownerOfB, ownerEmail } = await agencyWithDisabled(0)
  const platformAdmin = await seed(tdb.runtimeUrl, (s) => s.user())
  await admin.query(`update users set platform_role = 'admin' where id = $1`, [platformAdmin])
  await disableAt(ownerOfB, new Date(clock.now().getTime() - days(800)))
  await disableAt(platformAdmin, new Date(clock.now().getTime() - days(800)))
  await runRetention(deps())
  clock.advance(days(31))
  await runRetention(deps())
  await deliverNotices()
  for (const id of [ownerOfB, platformAdmin]) expect(await anonymizedAt(id)).toBeNull()
  expect(mailsTo(ownerEmail)).toHaveLength(0)
  const { rows } = await admin.query<{ reason: string }>(
    `select data->>'reason' as reason from audit_log
      where action = 'user.anonymization_skipped' and entity_id = any($1)`,
    [[ownerOfB, platformAdmin]],
  )
  expect(rows.map((r) => r.reason).sort()).toEqual(['owner', 'platform_admin'])
  // two people, two runs
  expect(warnings.filter((w) => w.includes('anonymization skipped'))).toHaveLength(4)
  expect(orgB).toBeTruthy()
})

test('running twice the same day changes nothing more', async () => {
  await agencyWithDisabled(701)
  await runRetention(deps())
  const again = await runRetention(deps())
  expect({ ...again, skipped: 0 }).toEqual({
    sessions: 0,
    devices: 0,
    auditIps: 0,
    verifications: 0,
    exportsExpired: 0,
    exportsFailed: 0,
    avatarPreviews: 0,
    noticesScheduled: 0,
    anonymized: 0,
    skipped: 0,
  })
})

test('retention queue is declared as a system queue', () => {
  expect(QUEUES.find((q) => q.name === 'identity.retention')).toMatchObject({
    scope: 'system',
    policy: 'singleton',
  })
})
