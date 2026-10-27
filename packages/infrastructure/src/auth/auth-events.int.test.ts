import { randomBytes } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  createAuthEventSink,
  resolveSessionUser,
  lockAccountFromSecurityEmail,
  type AuthEventSink,
  type JobPayloads,
  type JobQueue,
  type Logger,
  type UnitOfWork,
} from '@app/application'
import { createDb, type Db } from '../db/client.js'
import { auditLog } from '../db/audit/schema.js'
import { knownDevices, sessions, users, verifications } from '../db/identity/schema.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { fixedClock, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
const PASSWORD = 'una-password-molto-lunga-1'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
const NEW_PASSWORD = 'cavallo-batteria-graffetta-lago'
const chromeWindows =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const chromeWindowsNextVersion = chromeWindows.replace('Chrome/141', 'Chrome/142')
const safariIphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const deviceId = () => randomBytes(32).toString('base64url')

let tdb: TestDatabase
let db: Db
let admin: Db
let instance: BetterAuthInstance
let broken: BetterAuthInstance
let uow: UnitOfWork
const tokens = createSignedTokens(randomBytes(32))
const queued: { name: string; data: JobPayloads['identity.security_email'] }[] = []
const errors: unknown[] = []

const queue: JobQueue = {
  send(name, data) {
    queued.push({ name, data: data as JobPayloads['identity.security_email'] })
    return Promise.resolve(null)
  },
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

const quiet = createLogger({ service: 'web', level: 'error' })
const logger: Logger = {
  ...quiet,
  error(fields, message) {
    errors.push({ fields, message })
  },
}

function build(events: AuthEventSink): BetterAuthInstance {
  const secret = randomBytes(32).toString('hex')
  return createBetterAuth({
    db,
    config: {
      panelUrl: PANEL,
      productName: 'Feedway',
      secret,
      secrets: [{ version: 1, value: secret }],
    },
    ids: uuidV7Generator,
    clock: systemClock,
    hasher: createPasswordHasher(),
    rateLimiter: createPgRateLimiter({ db, clock: systemClock }),
    logger,
    queue,
    events,
    resolveSessionUser: (session) =>
      resolveSessionUser({ uow, config: { require2fa: 'admins' } }, session),
  })
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 5, applicationName: 'auth-events-test' }).db
  admin = createDb(tdb.adminUrl, { max: 2, applicationName: 'auth-events-admin' }).db
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  instance = build(createAuthEventSink({ uow, queue, tokens, clock: systemClock, logger }))
  broken = build({ record: () => Promise.reject(new Error('registro non disponibile')) })
})
afterAll(async () => {
  await tdb.stop()
})
beforeEach(() => {
  queued.length = 0
  errors.length = 0
})

let ipSeq = 0
const nextIp = () => `10.20.${String(Math.floor(++ipSeq / 250))}.${String(ipSeq % 250)}`

async function newUser() {
  const email = `evento-${uuidV7Generator.newId().slice(-12)}@example.test`
  const ctx = await instance.$context
  const id = uuidV7Generator.newId()
  await ctx.internalAdapter.createUser(
    { id, email, name: 'Persona Prova', emailVerified: true },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: id,
    providerId: 'credential',
    accountId: id,
    password: await ctx.password.hash(PASSWORD),
  })
  return { id, email }
}

interface RequestOptions {
  ip?: string
  userAgent?: string
  deviceId?: string | null
  cookie?: string
}

function post(path: string, body: unknown, opts: RequestOptions = {}, app = instance) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: PANEL,
    'x-app-client-ip': opts.ip ?? nextIp(),
    'x-app-request-id': uuidV7Generator.newId(),
    'user-agent': opts.userAgent ?? chromeWindows,
  }
  if (opts.deviceId !== null) headers['x-app-device-id'] = opts.deviceId ?? deviceId()
  if (opts.cookie !== undefined) headers['cookie'] = opts.cookie
  return app.handler(
    new Request(`${PANEL}/api/auth${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

async function signIn(email: string, password: string, opts: RequestOptions = {}, app = instance) {
  const res = await post('/sign-in/email', { email, password }, opts, app)
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-session='))
    ?.split(';')[0]
  return { res, cookie }
}

const auditOf = (actorId: string) =>
  admin.select().from(auditLog).where(eq(auditLog.actorId, actorId)).orderBy(asc(auditLog.id))
const securityEmails = (userId: string) =>
  queued.filter((q) => q.data.userId === userId).map((q) => q.data.kind)

test('successful sign-in is audited as a personal entry with method and ip', async () => {
  const { id, email } = await newUser()
  const { res } = await signIn(email, PASSWORD, { ip: '93.41.12.200' })
  expect(res.status).toBe(200)
  const [entry] = await auditOf(id)
  expect(entry).toMatchObject({
    action: 'auth.login',
    organizationId: null,
    actorId: id,
    ip: '93.41.12.200',
    data: { method: 'password', device: 'Chrome su Windows' },
  })
  const [session] = await admin.select().from(sessions).where(eq(sessions.userId, id))
  expect(session?.authMethod).toBe('password')
  const [user] = await admin.select().from(users).where(eq(users.id, id))
  expect(user?.lastLoginAt).not.toBeNull()
})

test('failed sign-in is audited without the attempted email or password', async () => {
  const { id, email } = await newUser()
  const nobody = `nessuno-${uuidV7Generator.newId().slice(-8)}@esempio.it`
  const ip = nextIp()
  expect((await signIn(email, 'sbagliata-123456', { ip })).res.status).toBe(401)
  expect((await signIn(nobody, 'sbagliata-123456', { ip })).res.status).toBe(401)
  const rows = await admin
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'auth.login_failed'), eq(auditLog.ip, ip)))
    .orderBy(asc(auditLog.id))
  expect(rows.map((r) => r.actorId)).toEqual([id, null])
  expect(rows.every((r) => r.organizationId === null)).toBe(true)
  expect(JSON.stringify(rows)).not.toMatch(/nessuno-|esempio\.it|sbagliata/)
})

test('first device sends no email, a second device does, the same device again does not', async () => {
  const { id, email } = await newUser()
  const [deviceA, deviceB] = [deviceId(), deviceId()]
  await signIn(email, PASSWORD, { userAgent: chromeWindows, deviceId: deviceA })
  expect(securityEmails(id)).toEqual([])
  await signIn(email, PASSWORD, { userAgent: safariIphone, deviceId: deviceB })
  expect(securityEmails(id)).toEqual(['new_device'])
  expect(queued.at(-1)?.data).toMatchObject({ deviceLabel: 'Safari su iOS', kind: 'new_device' })
  await signIn(email, PASSWORD, { userAgent: safariIphone, deviceId: deviceB })
  expect(securityEmails(id)).toEqual(['new_device'])
  expect((await auditOf(id)).filter((r) => r.action === 'auth.new_device')).toHaveLength(1)
  // only a keyed hash of the cookie id is stored, never the id itself
  const stored = await admin.select().from(knownDevices).where(eq(knownDevices.userId, id))
  expect(stored).toHaveLength(2)
  expect(stored.map((d) => d.deviceHash.toString('base64url'))).not.toContain(deviceA)
})

test('same browser and os on another device is a new device', async () => {
  const { id, email } = await newUser()
  await signIn(email, PASSWORD, { userAgent: chromeWindows, deviceId: deviceId() })
  await signIn(email, PASSWORD, { userAgent: chromeWindows, deviceId: deviceId() })
  expect(securityEmails(id)).toEqual(['new_device'])
  await signIn(email, PASSWORD, { userAgent: chromeWindows, deviceId: null })
  expect(securityEmails(id)).toEqual(['new_device', 'new_device'])
})

test('a browser update on the same device is not a new device', async () => {
  const { id, email } = await newUser()
  const device = deviceId()
  await signIn(email, PASSWORD, { userAgent: chromeWindows, deviceId: device })
  await signIn(email, PASSWORD, { userAgent: chromeWindowsNextVersion, deviceId: device })
  expect(securityEmails(id)).toEqual([])
})

test('password change and sign-out are audited, the change queues a security email', async () => {
  const { id, email } = await newUser()
  const { cookie } = await signIn(email, PASSWORD)
  expect(cookie).toBeDefined()
  const changed = await post(
    '/change-password',
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    { cookie: cookie ?? '' },
  )
  expect(changed.status).toBe(200)
  expect(securityEmails(id)).toEqual(['password_changed'])
  const fresh = changed.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-session='))
    ?.split(';')[0]
  expect((await post('/sign-out', {}, { cookie: fresh ?? cookie ?? '' })).status).toBe(200)
  const actions = (await auditOf(id)).map((r) => r.action)
  expect(actions).toEqual(['auth.login', 'auth.password_changed', 'auth.logout'])
})

test('logout keeps the address, the queued email gets only the shortened one', async () => {
  const { id, email } = await newUser()
  const { cookie } = await signIn(email, PASSWORD)
  const changed = await post(
    '/change-password',
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    { cookie: cookie ?? '', ip: '93.41.12.200' },
  )
  expect(changed.status).toBe(200)
  expect(queued.at(-1)?.data.ip).toBe('93.41.12.0')
  const fresh = changed.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-session='))
    ?.split(';')[0]
  await post('/sign-out', {}, { cookie: fresh ?? cookie ?? '', ip: '93.41.12.201' })
  const logout = (await auditOf(id)).find((r) => r.action === 'auth.logout')
  expect(logout?.ip).toBe('93.41.12.201')
})

test('a password reset is audited and queues a security email', async () => {
  const { id } = await newUser()
  const ctx = await instance.$context
  const token = randomBytes(16).toString('hex')
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: id,
    expiresAt: new Date(Date.now() + 600_000),
  })
  const res = await post('/reset-password', { token, newPassword: NEW_PASSWORD })
  expect(res.status).toBe(200)
  expect((await auditOf(id)).map((r) => r.action)).toEqual(['auth.password_reset'])
  expect(securityEmails(id)).toEqual(['password_reset'])
})

test('signing in while carrying an older session never inherits its start', async () => {
  const other = await newUser()
  const { id, email } = await newUser()
  const longAgo = new Date(Date.now() - 20 * 86_400_000)
  for (const person of [other, { id, email }]) {
    const { cookie } = await signIn(person.email, PASSWORD)
    await admin.update(sessions).set({ createdAt: longAgo }).where(eq(sessions.userId, person.id))
    // another person's session in the same browser, then the same person's own
    const { res } = await signIn(email, PASSWORD, { cookie: cookie ?? '' })
    expect(res.status).toBe(200)
    const [newest] = await admin
      .select()
      .from(sessions)
      .where(eq(sessions.userId, id))
      .orderBy(asc(sessions.createdAt))
      .then((rows) => rows.slice(-1))
    expect(Date.now() - (newest?.createdAt.getTime() ?? 0)).toBeLessThan(60_000)
  }
})

test('a failing sink does not break sign-in', async () => {
  const { email } = await newUser()
  const { res } = await signIn(email, PASSWORD, {}, broken)
  expect(res.status).toBe(200)
  expect(errors).toHaveLength(1)
})

test('a failure inside the sink is logged with the request id and changes nothing', async () => {
  const { email } = await newUser()
  const failing = createAuthEventSink({
    uow: {
      run: () => Promise.reject(new Error('database giù')),
      runAsSystem: () => Promise.reject(new Error('database giù')),
    },
    queue,
    tokens,
    clock: systemClock,
    logger,
  })
  const app = build(failing)
  const { res } = await signIn(email, PASSWORD, {}, app)
  expect(res.status).toBe(200)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    message: 'auth event not recorded',
    fields: { event: 'login' },
  })
  expect((errors[0] as { fields: { requestId: unknown } }).fields.requestId).toMatch(
    /^[0-9a-f-]{36}$/,
  )
})

/** Pending links and challenges as Better Auth writes them: the value names the person. */
async function pendingTokens(userId: string) {
  const rows = [
    { identifier: `reset-password:prova-${uuidV7Generator.newId()}`, value: userId },
    // the second factor waiting after the password
    { identifier: `prova-2fa-${uuidV7Generator.newId()}`, value: userId },
    // a passkey registration challenge
    {
      identifier: `prova-passkey-${uuidV7Generator.newId()}`,
      value: JSON.stringify({ expectedChallenge: 'sfida', userData: { id: userId } }),
    },
  ]
  for (const row of rows)
    await admin.insert(verifications).values({
      id: uuidV7Generator.newId(),
      ...row,
      expiresAt: new Date(Date.now() + 3600_000),
    })
  return rows.length
}

const lockNotices = () => queued.filter((q) => q.name === 'identity.account_locked_notice')

test('the lock link disables the account, closes every session and can be repeated', async () => {
  const { id, email } = await newUser()
  await signIn(email, PASSWORD)
  await signIn(email, PASSWORD)
  const pending = await pendingTokens(id)
  const someoneElse = await newUser()
  await pendingTokens(someoneElse.id)
  const clock = fixedClock(new Date())
  const token = tokens.sign('security_lock', {
    userId: id,
    issuedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
  })
  queued.length = 0
  await lockAccountFromSecurityEmail({ uow, tokens, clock, queue }, { token, ip: '93.41.12.200' })
  const [user] = await admin.select().from(users).where(eq(users.id, id))
  expect(user?.status).toBe('disabled')
  expect(user?.disabledAt).not.toBeNull()
  expect(await admin.select().from(sessions).where(eq(sessions.userId, id))).toEqual([])
  // every pending link or challenge of the person, and the devices they were known on
  const left = await admin.select().from(verifications)
  expect(left.filter((v) => v.value.includes(id))).toEqual([])
  expect(left.filter((v) => v.value.includes(someoneElse.id))).toHaveLength(pending)
  expect(await admin.select().from(knownDevices).where(eq(knownDevices.userId, id))).toEqual([])
  // one notice for the administrators, with ids only
  expect(lockNotices()).toEqual([
    {
      name: 'identity.account_locked_notice',
      data: { lockedUserId: id, lockedAt: clock.now().toISOString() },
    },
  ])

  clock.advance(1000)
  await expect(
    lockAccountFromSecurityEmail({ uow, tokens, clock, queue }, { token, ip: null }),
  ).resolves.toBeUndefined()
  expect(lockNotices()).toHaveLength(1)
  expect((await auditOf(id)).filter((r) => r.action === 'auth.security_lock')).toEqual([
    expect.objectContaining({
      ip: '93.41.12.200',
      data: { sessionsClosed: 2, tokensRevoked: pending + 2 },
    }),
  ])
  // a disabled account cannot sign in again
  expect((await signIn(email, PASSWORD)).res.status).toBe(401)
})

test('a lock is repeatable: a later pending link is revoked too, without a second notice', async () => {
  const { id } = await newUser()
  const clock = fixedClock(new Date())
  const token = tokens.sign('security_lock', {
    userId: id,
    issuedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
  })
  const lockDeps = { uow, tokens, clock, queue }
  await lockAccountFromSecurityEmail(lockDeps, { token, ip: null })
  const pending = await pendingTokens(id)
  await lockAccountFromSecurityEmail(lockDeps, { token, ip: null })
  const left = await admin.select().from(verifications)
  expect(left.filter((v) => v.value.includes(id))).toEqual([])
  expect(lockNotices()).toHaveLength(1)
  expect(
    (await auditOf(id)).filter((r) => r.action === 'auth.security_lock').map((r) => r.data),
  ).toEqual([
    { sessionsClosed: 0, tokensRevoked: 0 },
    { sessionsClosed: 0, tokensRevoked: pending },
  ])
})

test('a lock whose notice cannot be queued changes nothing', async () => {
  const { id, email } = await newUser()
  await signIn(email, PASSWORD)
  const clock = fixedClock(new Date())
  const token = tokens.sign('security_lock', {
    userId: id,
    issuedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
  })
  const down: JobQueue = { ...queue, send: () => Promise.reject(new Error('coda giù')) }
  await expect(
    lockAccountFromSecurityEmail({ uow, tokens, clock, queue: down }, { token, ip: null }),
  ).rejects.toThrow('coda giù')
  const [user] = await admin.select().from(users).where(eq(users.id, id))
  expect(user).toMatchObject({ status: 'active', securityLockedAt: null })
  expect(await admin.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(1)
})

test('an expired or forged lock link is invalid', async () => {
  const { id } = await newUser()
  const clock = fixedClock(new Date())
  const token = tokens.sign('security_lock', {
    userId: id,
    issuedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
  })
  clock.advance(8 * 86_400_000)
  await expect(
    lockAccountFromSecurityEmail({ uow, tokens, clock, queue }, { token, ip: null }),
  ).rejects.toMatchObject({ code: 'LINK_INVALID' })
  await expect(
    lockAccountFromSecurityEmail(
      { uow, tokens, clock, queue },
      { token: 'non-un-token', ip: null },
    ),
  ).rejects.toMatchObject({ code: 'LINK_INVALID' })
  const [user] = await admin.select().from(users).where(eq(users.id, id))
  expect(user?.status).toBe('active')
})
