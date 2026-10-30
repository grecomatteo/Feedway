import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  createMailSettings,
  getPlatformMailSettings,
  replacePlatformMailSettings,
  sendPlatformTestEmail,
  SYSTEM_PLATFORM_ACTOR,
  type AuthSessionInfo,
  type PlatformMailDeps,
  type PlatformPanelRequest,
} from '@app/application'
import type { PlatformActor } from '@app/domain'
import { createKeyRing } from '../crypto/key-ring.js'
import { createDb } from '../db/client.js'
import type { DbHandle } from '../db/client.js'
import { createIntegrationStore } from '../db/integrations/integration-store.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createTranslate } from '../i18n/translate.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startFakeSmtp, startTestDatabase } from '../testing/index.js'
import type { FakeSmtp, TestDatabase } from '../testing/index.js'
import { createSmtpMailer } from './smtp-mailer.js'
import { createSmtpSender } from './smtp/smtp-sender.js'

// Only a fake server on 127.0.0.1: no real mail server is ever contacted.
const HOST = 'smtp.feedway.test'
const PASSWORD = 'parola-di-prova-giusta'
const WRONG = 'parola-di-prova-sbagliata'

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let fake: FakeSmtp
let deps: PlatformMailDeps
let adminId: string
let actor: PlatformActor

const logLines: string[] = []
const logger = createLogger({
  service: 'web',
  level: 'debug',
  destination: new Writable({
    write(chunk: Buffer, _enc, cb) {
      logLines.push(chunk.toString('utf8'))
      cb()
    },
  }),
})

const translate = createTranslate(
  JSON.parse(
    readFileSync(new URL('../../../../apps/web/i18n/locales/it.json', import.meta.url), 'utf8'),
  ) as unknown,
)

const settings = (over: Record<string, unknown> = {}) => ({
  host: HOST,
  port: 587 as const,
  username: 'invii@feedway.test',
  from: 'avvisi@feedway.test',
  ...over,
})

function session(over: Partial<AuthSessionInfo> = {}): AuthSessionInfo {
  const now = new Date()
  return {
    id: 'sessione',
    userId: adminId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
    authMethod: 'password',
    reauthenticatedAt: now,
    ...over,
  }
}
const panel = (over: Partial<AuthSessionInfo> = {}): PlatformPanelRequest => ({
  ip: '203.0.113.7',
  session: session(over),
})

const auditRows = async (action: string) =>
  (
    await admin.query<{ actor_id: string | null; source: string; data: Record<string, unknown> }>(
      'select actor_id, source, data from audit_log where action = $1 order by created_at',
      [action],
    )
  ).rows

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  fake = await startFakeSmtp({ names: [HOST], password: PASSWORD })
  const uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  const integrations = createIntegrationStore({
    keyRing: createKeyRing({ platformKey: randomBytes(32), clock: systemClock }),
  })
  deps = {
    uow,
    integrations,
    clock: systemClock,
    rateLimiter: createPgRateLimiter({ db: handle.db, clock: systemClock }),
    mailer: createSmtpMailer({
      settings: createMailSettings({ uow, integrations }),
      smtp: createSmtpSender({
        clientName: 'app.feedway.test',
        testing: { fakeServer: { port: fake.port, ca: fake.ca } },
      }),
      logger,
    }),
    translate,
    logger,
    panelUrl: new URL('https://app.feedway.test'),
    productName: 'Feedway',
  }
  adminId = await seed(tdb.runtimeUrl, (s) => s.user({ email: 'piattaforma@feedway.test' }))
  await admin.query("update users set platform_role = 'admin' where id = $1", [adminId])
  actor = { userId: adminId, platformRole: 'admin' }
}, 120_000)

afterAll(async () => {
  await fake.stop()
  await admin.end()
  await handle.close()
  await tdb.stop()
})

beforeEach(async () => {
  await admin.query('delete from rate_limit_counters')
})

test('nothing set yet: no settings, and a test email says so', async () => {
  expect(await getPlatformMailSettings(deps, SYSTEM_PLATFORM_ACTOR)).toBeNull()
  const result = await sendPlatformTestEmail(deps, actor, 'prova@feedway.test', panel())
  expect(result).toEqual({ ok: false, kind: 'not_configured', response: null })
  expect(fake.received).toHaveLength(0)
})

test('the password is needed the first time', async () => {
  await expect(
    replacePlatformMailSettings(deps, SYSTEM_PLATFORM_ACTOR, settings()),
  ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'password' } })
})

test('settings are stored, shown without the password, and the change is recorded by name', async () => {
  const view = await replacePlatformMailSettings(
    deps,
    actor,
    settings({ host: ' SMTP.Feedway.test ', secret: WRONG }),
    panel(),
  )
  expect(view).toMatchObject({
    host: HOST,
    port: 587,
    security: 'starttls',
    username: 'invii@feedway.test',
    from: 'avvisi@feedway.test',
    secretSet: true,
    verifiedAt: null,
  })
  expect(JSON.stringify(view)).not.toContain('parola')
  expect(await getPlatformMailSettings(deps, actor)).toEqual(view)
  const [entry] = await auditRows('platform.mail_settings_changed')
  expect(entry).toEqual({
    actor_id: adminId,
    source: 'panel',
    data: { fields: ['host', 'port', 'security', 'username', 'from', 'password'] },
  })
})

test('a failed test: classified, the cleaned reply only, nothing verified', async () => {
  const result = await sendPlatformTestEmail(deps, actor, 'prova@feedway.test', panel())
  expect(result.ok).toBe(false)
  expect(result.kind).toBe('auth')
  expect(result.response ?? '').not.toMatch(/parola|invii@/)
  expect((await getPlatformMailSettings(deps, actor))?.verifiedAt).toBeNull()
  expect(await auditRows('platform.mail_test_sent')).toEqual([
    { actor_id: adminId, source: 'panel', data: { ok: false, kind: 'not_configured' } },
    { actor_id: adminId, source: 'panel', data: { ok: false, kind: 'auth' } },
  ])
  expect(logLines.join('\n')).not.toMatch(/parola-di-prova/)
})

test('only the password changes: the rest stays, the entry names the password alone', async () => {
  await admin.query('delete from audit_log')
  const view = await replacePlatformMailSettings(
    deps,
    SYSTEM_PLATFORM_ACTOR,
    settings({ secret: PASSWORD }),
  )
  expect(view.host).toBe(HOST)
  expect(await auditRows('platform.mail_settings_changed')).toEqual([
    { actor_id: null, source: 'system', data: { fields: ['password'] } },
  ])
  // the same settings again, without a password: nothing changes, nothing recorded
  await replacePlatformMailSettings(deps, SYSTEM_PLATFORM_ACTOR, settings())
  expect(await auditRows('platform.mail_settings_changed')).toHaveLength(1)
})

test('a test that leaves marks the settings verified; a later change resets it', async () => {
  const result = await sendPlatformTestEmail(deps, actor, ' prova@feedway.test ', panel())
  expect(result).toEqual({ ok: true, kind: 'sent', response: null })
  const mail = fake.received.at(-1)
  expect(mail?.to).toEqual(['prova@feedway.test'])
  expect(mail?.data).toMatch(/^Subject: /m)
  expect(mail?.data).toMatch(/funziona/)
  const verified = await getPlatformMailSettings(deps, actor)
  expect(verified?.verifiedAt).toBeInstanceOf(Date)
  expect(await auditRows('platform.mail_test_sent')).toEqual([
    { actor_id: adminId, source: 'panel', data: { ok: true, kind: 'sent' } },
  ])
  const changed = await replacePlatformMailSettings(
    deps,
    actor,
    settings({ from: 'sistema@feedway.test' }),
    panel(),
  )
  expect(changed.verifiedAt).toBeNull()
})

test('the panel needs a recent reauth of the same person; the CLI does not', async () => {
  const stale = panel({ reauthenticatedAt: new Date(Date.now() - 60 * 60_000) })
  await expect(replacePlatformMailSettings(deps, actor, settings(), stale)).rejects.toMatchObject({
    code: 'REAUTH_REQUIRED',
  })
  await expect(
    sendPlatformTestEmail(deps, actor, 'prova@feedway.test', { ip: null, session: null }),
  ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
  await expect(
    sendPlatformTestEmail(deps, actor, 'prova@feedway.test', panel({ userId: 'qualcun-altro' })),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    sendPlatformTestEmail(deps, SYSTEM_PLATFORM_ACTOR, 'prova@feedway.test'),
  ).resolves.toMatchObject({ ok: true })
})

test('only the platform administrator, read again from the database', async () => {
  const someone = { userId: adminId, platformRole: null }
  await expect(getPlatformMailSettings(deps, someone)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  // an actor built before the demotion counts for nothing
  await admin.query('update users set platform_role = null where id = $1', [adminId])
  try {
    await expect(getPlatformMailSettings(deps, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      sendPlatformTestEmail(deps, actor, 'prova@feedway.test', panel()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  } finally {
    await admin.query("update users set platform_role = 'admin' where id = $1", [adminId])
  }
})

test('one plain address only', async () => {
  for (const to of [
    'a@b.test, c@d.test',
    'Nome <a@b.test>',
    'a@b.test\r\nBcc: c@d.test',
    'nessuno',
  ])
    await expect(sendPlatformTestEmail(deps, actor, to, panel())).rejects.toMatchObject({
      code: 'VALIDATION',
    })
})

test('five tests every ten minutes for each administrator', async () => {
  for (let i = 0; i < 5; i++)
    await expect(
      sendPlatformTestEmail(deps, actor, 'prova@feedway.test', panel()),
    ).resolves.toMatchObject({ ok: true })
  await expect(
    sendPlatformTestEmail(deps, actor, 'prova@feedway.test', panel()),
  ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
})

test('invalid settings are refused before anything is stored', async () => {
  const before = await getPlatformMailSettings(deps, actor)
  for (const bad of [
    settings({ host: 'non un host' }),
    settings({ from: 'non-un-indirizzo' }),
    settings({ port: 25 }),
    settings({ port: 465, security: 'starttls' }),
  ])
    await expect(
      replacePlatformMailSettings(deps, SYSTEM_PLATFORM_ACTOR, bad as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  expect(await getPlatformMailSettings(deps, actor)).toEqual(before)
})
