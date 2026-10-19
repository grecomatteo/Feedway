import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDb, type Db } from '../db/client.js'
import { accounts, sessions, users } from '../db/identity/schema.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { startTestDatabase, type TestDatabase } from '../testing/index.js'
import { SESSION_ABSOLUTE_MS } from '@app/domain'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
const PASSWORD = 'una-password-molto-lunga-1'
const uuidV7Re = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let tdb: TestDatabase
let db: Db
let instance: BetterAuthInstance
let other: BetterAuthInstance

function build(): BetterAuthInstance {
  const logger = createLogger({ service: 'web', level: 'error' })
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
    // the events are tested in packages/application/src/identity/auth-events.int.test.ts
    events: { record: () => Promise.resolve() },
  })
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 5, applicationName: 'auth-test' }).db
  instance = build()
  other = build()
})
afterAll(async () => {
  await tdb.stop()
})

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`manca: ${what}`)
  return value
}

let counter = 0
let ipSeq = 0
/** A person with a password account, created as the activation will create them (V2). */
async function newUser(password = PASSWORD, status: 'active' | 'disabled' = 'active') {
  counter += 1
  const email = `persona${String(counter)}-${uuidV7Generator.newId().slice(-6)}@example.test`
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
    password: await ctx.password.hash(password),
  })
  if (status === 'disabled')
    await db
      .update(users)
      .set({ status: 'disabled', disabledAt: new Date() })
      .where(eq(users.id, id))
  return { id, email }
}

function post(
  path: string,
  body: unknown,
  init: { cookie?: string | undefined; ip?: string | undefined } = {},
  app = instance,
) {
  return app.handler(
    new Request(`${PANEL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PANEL,
        'x-app-client-ip':
          init.ip ??
          `10.${String(counter % 250)}.${String(Math.floor(counter / 250))}.${String(++ipSeq % 250)}`,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
}

async function signIn(email: string, password: string, ip?: string, app = instance) {
  const res = await post('/sign-in/email', { email, password }, { ip }, app)
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-session='))
  return { res, cookie: setCookie?.split(';')[0] }
}

describe('Better Auth configuration', () => {
  test('only the plugins we chose are active, plus our server-only activation session', () => {
    expect(instance.options.plugins.map((p) => p.id).sort()).toEqual([
      'activation-session',
      'passkey',
      'two-factor',
    ])
  })

  test.each(['/sign-up/email', '/update-user', '/delete-user', '/list-accounts', '/link-social'])(
    'path %s answers 404',
    async (path) => {
      expect((await post(path, {})).status).toBe(404)
    },
  )

  test('sign-in stores an argon2id hash and sets a host-only __Host- cookie', async () => {
    const { id, email } = await newUser()
    const { res, cookie } = await signIn(email, PASSWORD)
    expect(res.status).toBe(200)
    expect(cookie).toBeDefined()
    const setCookie = must(
      res.headers.getSetCookie().find((c) => c.startsWith('__Host-session=')),
      'session cookie',
    )
    expect(setCookie).toMatch(/; Path=\//)
    expect(setCookie).toMatch(/; Secure/)
    expect(setCookie).toMatch(/; HttpOnly/)
    expect(setCookie).not.toMatch(/Domain=/i)
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, id))
    expect(account?.password).toMatch(/^\$argon2id\$/)
  })

  test('the session starts with the method of the sign-in path, not a default', async () => {
    const { id, email } = await newUser()
    await signIn(email, PASSWORD)
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, id))
    expect(row?.authMethod).toBe('password')
    expect(row?.id).toMatch(uuidV7Re)
  })

  test('a wrong password and an unknown email get the same answer', async () => {
    const { email } = await newUser()
    const wrong = await signIn(email, 'sbagliata-123456', '198.51.100.1')
    const unknown = await signIn('nessuno-qui@example.test', 'sbagliata-123456', '198.51.100.2')
    expect(wrong.res.status).toBe(unknown.res.status)
    expect(await wrong.res.json()).toEqual(await unknown.res.json())
  })
})

describe('sessions', () => {
  test('a revocation holds on another process at once', async () => {
    const { id, email } = await newUser()
    const { cookie } = await signIn(email, PASSWORD)
    const adapter = createAuthAdapter(instance, { db, clock: systemClock })
    const otherAdapter = createAuthAdapter(other, { db, clock: systemClock })
    expect(await adapter.getSession(new Headers({ cookie: must(cookie, 'cookie') }))).not.toBeNull()
    expect(await adapter.revokeAllSessions(id)).toBe(1)
    expect(
      await otherAdapter.getSession(new Headers({ cookie: must(cookie, 'cookie') })),
    ).toBeNull()
  })

  test('revokeAllSessions keeps the session named in exceptSessionId', async () => {
    const { id, email } = await newUser()
    await signIn(email, PASSWORD)
    await signIn(email, PASSWORD)
    const adapter = createAuthAdapter(instance, { db, clock: systemClock })
    const [kept] = await adapter.listSessions(id)
    expect(await adapter.revokeAllSessions(id, { exceptSessionId: must(kept, 'kept').id })).toBe(1)
    expect((await adapter.listSessions(id)).map((s) => s.id)).toEqual([must(kept, 'kept').id])
  })

  test('a session older than 30 days is revoked on its next use', async () => {
    const { id, email } = await newUser()
    const { cookie } = await signIn(email, PASSWORD)
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - SESSION_ABSOLUTE_MS - 60_000) })
      .where(eq(sessions.userId, id))
    const adapter = createAuthAdapter(instance, { db, clock: systemClock })
    expect(await adapter.getSession(new Headers({ cookie: must(cookie, 'cookie') }))).toBeNull()
    expect(await adapter.listSessions(id)).toEqual([])
  })

  test('a disabled person gets no session, and the answer does not tell why', async () => {
    const { id, email } = await newUser(PASSWORD, 'disabled')
    const refused = await signIn(email, PASSWORD)
    const wrong = await signIn(email, 'sbagliata-123456')
    expect(refused.res.status).toBe(wrong.res.status)
    expect(await refused.res.json()).toEqual(await wrong.res.json())
    const left = await db.select().from(sessions).where(eq(sessions.userId, id))
    expect(left).toEqual([])
  })
})

describe('limits', () => {
  test('ten sign-ins a minute from one IP, counted across processes', async () => {
    const ip = '192.0.2.10'
    for (let i = 0; i < 5; i++) {
      await signIn(`ip-${String(i)}@example.test`, 'sbagliata-123456', ip, instance)
      await signIn(`ip-b-${String(i)}@example.test`, 'sbagliata-123456', ip, other)
    }
    const blocked = await signIn('ip-c@example.test', 'sbagliata-123456', ip, instance)
    expect(blocked.res.status).toBe(429)
    expect(Number(blocked.res.headers.get('retry-after'))).toBeGreaterThan(0)
    const elsewhere = await signIn('ip-d@example.test', 'sbagliata-123456', '192.0.2.11', instance)
    expect(elsewhere.res.status).not.toBe(429)
  })

  test('five failures on one account impose a growing wait, even for the right password', async () => {
    const { email } = await newUser()
    for (let i = 0; i < 5; i++)
      await signIn(email, 'sbagliata-123456', `198.51.100.${String(10 + i)}`)
    const { res } = await signIn(email, PASSWORD, '198.51.100.99')
    expect(res.status).toBe(429)
    const retryAfter = Number(res.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(25)
    expect(retryAfter).toBeLessThanOrEqual(30)
  })

  test('trustDevice is refused', async () => {
    const { email } = await newUser()
    const { cookie } = await signIn(email, PASSWORD)
    const res = await post(
      '/two-factor/verify-totp',
      { code: '123456', trustDevice: true },
      { cookie },
    )
    expect(res.status).toBe(400)
  })

  test('rememberMe false is refused: it would skip the 12-hour idle limit', async () => {
    const { email } = await newUser()
    const res = await post('/sign-in/email', { email, password: PASSWORD, rememberMe: false })
    expect(res.status).toBe(400)
  })

  test('a new password built on the account email is refused', async () => {
    const { email } = await newUser()
    const { cookie } = await signIn(email, PASSWORD)
    const local = email.split('@')[0] ?? ''
    const res = await post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: local },
      { cookie },
    )
    expect(res.status).toBe(422)
  })

  test('a weak new password is refused with the reason', async () => {
    const { email } = await newUser()
    const { cookie } = await signIn(email, PASSWORD)
    const res = await post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: 'passwordpassword' },
      { cookie },
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'TOO_WEAK' })
  })
})

test('the users table exists with the columns the sign-in reads', async () => {
  const { id } = await newUser()
  const [row] = await db.select().from(users).where(eq(users.id, id))
  expect(row?.status).toBe('active')
})
