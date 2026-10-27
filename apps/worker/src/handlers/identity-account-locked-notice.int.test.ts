import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { JobPayloads, JobQueue, Mailer } from '@app/application'
import { createMemoryMailer, createRuntime, notConfiguredMailer } from '@app/infrastructure'
import type { Runtime } from '@app/infrastructure'
import { fixedClock, seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { createTranslate, loadItalianMessages } from '../i18n.js'
import type { JobHandlerDeps } from '../job-handler.js'
import {
  identityAccountLockedNotice,
  identityAccountLockedNoticeEmail,
} from './identity-account-locked-notice.js'

const PANEL = new URL('https://pannello.example.test')
// 19:20 in Rome
const LOCKED_AT = new Date('2026-10-26T18:20:00Z')

let tdb: TestDatabase
let runtime: Runtime
let admin: pg.Client
let mediaRoot: string
let platformAdmin: { id: string; email: string }

beforeAll(async () => {
  tdb = await startTestDatabase()
  mediaRoot = await mkdtemp(join(tmpdir(), 'lock-notice-'))
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
  platformAdmin = await user('amministratore')
  await admin.query("update users set platform_role = 'admin' where id = $1", [platformAdmin.id])
  // a disabled administrator is told nothing
  const former = await user('ex-amministratore')
  await admin.query(
    "update users set platform_role = 'admin', status = 'disabled', disabled_at = now() where id = $1",
    [former.id],
  )
})
afterAll(async () => {
  await admin.end()
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await rm(mediaRoot, { recursive: true, force: true })
  await tdb.stop()
})

type NoticeEmail = JobPayloads['identity.account_locked_notice_email']
const queued: NoticeEmail[] = []
const recording: JobQueue = {
  send(name, data) {
    if (name === 'identity.account_locked_notice_email') queued.push(data as NoticeEmail)
    return Promise.resolve(null)
  },
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

function depsWith(mailer: Mailer, queue: JobQueue = recording): JobHandlerDeps {
  return {
    logger: runtime.logger,
    queue,
    uow: runtime.uow,
    clock: fixedClock(new Date(LOCKED_AT.getTime() + 60_000)),
    ids: runtime.ids,
    storage: runtime.storage,
    mailer,
    signedTokens: runtime.signedTokens,
    translate: createTranslate(loadItalianMessages()),
    panel: { url: PANEL, productName: 'Feedway', defaultTimezone: 'Europe/Rome' },
  }
}

async function user(prefix: string, name = 'Persona Prova') {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.test`
  const id = await seed(tdb.runtimeUrl, (s) => s.user({ email, name }))
  return { id, email }
}

async function lock(userId: string, at = LOCKED_AT) {
  await admin.query(
    "update users set status = 'disabled', disabled_at = $2, security_locked_at = $2 where id = $1",
    [userId, at],
  )
}

const job = (lockedUserId: string, lockedAt = LOCKED_AT) => ({
  id: randomUUID(),
  data: { lockedUserId, lockedAt: lockedAt.toISOString() },
})

async function notified(userId: string) {
  const { rows } = await admin.query<{
    data: Record<string, unknown>
    organization_id: string | null
    source: string
  }>(
    "select data, organization_id, source from audit_log where action = 'auth.security_lock_notified' and entity_id = $1",
    [userId],
  )
  return rows
}

async function organizationName(id: string) {
  const { rows } = await admin.query<{ name: string }>(
    'select name from organizations where id = $1',
    [id],
  )
  return rows[0]?.name ?? ''
}

test('the platform administrators and the Owners of the person’s agencies are told', async () => {
  const locked = await user('bloccata', 'Marta Bianchi')
  const owner = await user('titolare')
  const notTold = await Promise.all(
    ['titolare-disattivato', 'titolare-sospesa', 'titolare-ex-membro', 'titolare-spento'].map((p) =>
      user(p),
    ),
  )
  const [disabledOwner, suspendedOwner, formerOwner, offOwner] = notTold
  if (!disabledOwner || !suspendedOwner || !formerOwner || !offOwner) throw new Error('setup')
  await admin.query("update users set status = 'disabled' where id = $1", [offOwner.id])
  const told = await seed(tdb.runtimeUrl, async (s) => {
    const active = await s.organization()
    await s.member(active, locked.id, 'member')
    await s.member(active, owner.id, 'owner')
    // an Owner whose membership the agency disabled
    const withDisabledOwner = await s.organization()
    await s.member(withDisabledOwner, locked.id, 'member')
    await s.member(withDisabledOwner, disabledOwner.id, 'owner', 'disabled')
    // a suspended agency
    const suspended = await s.organization({ status: 'suspended' })
    await s.member(suspended, locked.id, 'member')
    await s.member(suspended, suspendedOwner.id, 'owner')
    // an agency that no longer counts the person among its active members
    const former = await s.organization()
    await s.member(former, locked.id, 'member', 'disabled')
    await s.member(former, formerOwner.id, 'owner')
    // an Owner whose account is disabled
    const off = await s.organization()
    await s.member(off, locked.id, 'member')
    await s.member(off, offOwner.id, 'owner')
    // the person is the Owner: nobody else to tell there
    const own = await s.organization()
    await s.member(own, locked.id, 'owner')
    // an administrator who is also an Owner gets one email, the administrator's
    const alsoAdmin = await s.organization()
    await s.member(alsoAdmin, locked.id, 'admin')
    await s.member(alsoAdmin, platformAdmin.id, 'owner')
    return { active }
  })
  await lock(locked.id)
  const mailer = createMemoryMailer()
  // one job per recipient, each sent on its own: a retry never writes twice to anyone
  queued.length = 0
  await identityAccountLockedNotice(job(locked.id), depsWith(mailer))
  expect(queued).toHaveLength(2)
  for (const data of queued)
    await identityAccountLockedNoticeEmail({ id: randomUUID(), data }, depsWith(mailer))

  expect(mailer.sent.map((m) => m.to).sort()).toEqual([owner.email, platformAdmin.email].sort())
  for (const mail of mailer.sent) {
    expect(mail.subject).toBe('Account bloccato: Marta Bianchi · Feedway')
    expect(mail.text.split('\n')[0]).toBe('Marta Bianchi ha bloccato il suo account')
    expect(mail.text).toMatch(/lunedì 26 ottobre 2026 alle 19:20 \(ora italiana\)/)
    expect(mail.text).toContain('Cosa abbiamo già fatto: abbiamo chiuso tutte le sessioni')
    expect(mail.text).toContain('annullato i link in sospeso')
    expect(mail.text).toContain('telefonata a un numero che conosci già')
    // no action link, no token: only the logo is a web address, in the html
    expect(mail.text).not.toMatch(/https?:\/\//)
    expect(mail.html.match(/href=/g)).toBeNull()
  }
  const forAdmin = mailer.sent.find((m) => m.to === platformAdmin.email)
  const forOwner = mailer.sent.find((m) => m.to === owner.email)
  // the address only to the platform administrators
  expect(forAdmin?.text).toContain(locked.email)
  expect(forAdmin?.text).toContain('riattivala con cli enable-user')
  expect(forOwner?.text).not.toContain(locked.email)
  expect(forOwner?.text).toContain(await organizationName(told.active))
  expect(forOwner?.text).toContain('La riattivazione la fa un amministratore della piattaforma')

  // the count only: never an address
  expect(await notified(locked.id)).toEqual([
    { data: { recipients: 2 }, organization_id: null, source: 'system' },
  ])
})

test('a notice for a lock not yet committed is retried; after a reactivation it is dropped', async () => {
  const locked = await user('in-attesa')
  const mailer = createMemoryMailer()
  queued.length = 0
  await expect(identityAccountLockedNotice(job(locked.id), depsWith(mailer))).rejects.toThrow()
  expect(queued).toEqual([])

  await admin.query('update users set reactivated_at = $2 where id = $1', [
    locked.id,
    new Date(LOCKED_AT.getTime() + 1000),
  ])
  await identityAccountLockedNotice(job(locked.id), depsWith(mailer))
  expect(queued).toEqual([])
  expect(await notified(locked.id)).toEqual([])
})

test('without email configured the job completes and records that nobody was told', async () => {
  const locked = await user('senza-posta')
  await lock(locked.id)
  await identityAccountLockedNotice(job(locked.id), depsWith(notConfiguredMailer))
  expect(await notified(locked.id)).toEqual([
    { data: { recipients: 0 }, organization_id: null, source: 'system' },
  ])
})

test('a retried notice queues each recipient once, and a failed email is retried alone', async () => {
  const locked = await user('ripetuto')
  const owner = await user('titolare-ripetuto')
  await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    await s.member(org, locked.id, 'member')
    await s.member(org, owner.id, 'owner')
  })
  await lock(locked.id)
  // the real queue: the second run (a pg-boss retry) adds nothing
  const mailer = createMemoryMailer()
  await identityAccountLockedNotice(job(locked.id), depsWith(mailer, runtime.queue))
  await identityAccountLockedNotice(job(locked.id), depsWith(mailer, runtime.queue))
  const { rows } = await admin.query<{ data: NoticeEmail }>(
    "select data from pgboss.job where name = 'identity.account_locked_notice_email'",
  )
  const mine = rows.map((r) => r.data).filter((d) => d.lockedUserId === locked.id)
  expect(mine.map((d) => d.recipientId).sort()).toEqual([owner.id, platformAdmin.id].sort())

  // the Owner's mail server fails: only the Owner's job fails, the administrator is not resent
  const failing: Mailer = {
    isConfigured: () => Promise.resolve(true),
    send: (m) => (m.to === owner.email ? Promise.reject(new Error('smtp giù')) : mailer.send(m)),
  }
  const results = await Promise.allSettled(
    mine.map((data) =>
      identityAccountLockedNoticeEmail({ id: randomUUID(), data }, depsWith(failing)),
    ),
  )
  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(mailer.sent.map((m) => m.to)).toEqual([platformAdmin.email])
})
