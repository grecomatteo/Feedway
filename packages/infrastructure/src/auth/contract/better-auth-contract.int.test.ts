import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { APIError, createAuthEndpoint, createAuthMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import { startTestDatabase } from '../../testing/test-database.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import {
  createContractDatabase,
  CONTRACT_ORIGIN,
  CONTRACT_SECRET,
  minimalAuth,
  type ContractDatabase,
  type MinimalAuth,
} from './minimal-auth.js'
import { cookieHeader, parseSetCookie, secretOf, totpCode } from './helpers.js'

const PASSWORD = 'una-password-molto-lunga-1'
interface OpenSessionApi {
  openSession(input: {
    body: { userId: string }
    returnHeaders: true
  }): Promise<{ headers: Headers }>
}
const uuidV7Re = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let stopBase: (() => Promise<void>) | undefined
let contract: ContractDatabase
let m: MinimalAuth

let counter = 0
/** A user with a credential account, created like the invitation activation will (V2). */
async function newUser(a: MinimalAuth = m) {
  counter += 1
  const email = `user${String(counter)}-${uuidV7Generator.newId().slice(-6)}@example.test`
  const ctx = await a.auth.$context
  const id = uuidV7Generator.newId()
  await ctx.internalAdapter.createUser(
    { id, email, name: 'Utente', emailVerified: true },
    {
      method: 'admin',
    },
  )
  await ctx.internalAdapter.linkAccount({
    userId: id,
    providerId: 'credential',
    accountId: id,
    password: await ctx.password.hash(PASSWORD),
  })
  return { id, email }
}

async function signIn(a: MinimalAuth, email: string) {
  const res = await a.httpPost('/sign-in/email', { email, password: PASSWORD })
  expect(res.status).toBe(200)
  return {
    res,
    cookie: cookieHeader(res.headers.getSetCookie()),
    setCookies: res.headers.getSetCookie(),
  }
}

beforeAll(async () => {
  const external = process.env['CONTRACT_ADMIN_URL']
  let adminUrl = external
  if (!adminUrl) {
    const base = await startTestDatabase()
    stopBase = () => base.stop()
    adminUrl = base.adminUrl
  }
  contract = await createContractDatabase(adminUrl)
  m = minimalAuth(contract.pool)
})

afterAll(async () => {
  await contract.stop()
  await stopBase?.()
})

describe('V1 two factor secrets at rest', () => {
  test('totp secret and backup codes are not stored in clear', async () => {
    const { id, email } = await newUser()
    const { cookie } = await signIn(m, email)
    const enable = await m.httpPost('/two-factor/enable', { password: PASSWORD }, cookie)
    const body = (await enable.json()) as { totpURI: string; backupCodes: string[] }
    const secret = secretOf(body.totpURI)
    const row = await m.rawRow('two_factors', { user_id: id })
    expect(row['secret']).not.toContain(secret)
    for (const code of body.backupCodes) expect(row['backup_codes']).not.toContain(code)
  })
})

describe('V1b secret rotation', () => {
  test('totp enrolled before a secret rotation still verifies after it', async () => {
    const { email } = await newUser()
    const { cookie } = await signIn(m, email)
    const enable = await m.httpPost('/two-factor/enable', { password: PASSWORD }, cookie)
    const secret = secretOf(((await enable.json()) as { totpURI: string }).totpURI)
    expect(
      (await m.httpPost('/two-factor/verify-totp', { code: totpCode(secret) }, cookie)).status,
    ).toBe(200)
    const rotated = minimalAuth(contract.pool, {
      secrets: [
        { version: 2, value: 'rotated-secret-'.padEnd(48, 'r') },
        { version: 1, value: CONTRACT_SECRET },
      ],
    })
    const login = await rotated.httpPost('/sign-in/email', { email, password: PASSWORD })
    expect(await login.clone().json()).toMatchObject({ twoFactorRedirect: true })
    const challenge = cookieHeader(login.headers.getSetCookie())
    const verified = await rotated.httpPost(
      '/two-factor/verify-totp',
      { code: totpCode(secret, Date.now() + 30_000) },
      challenge,
    )
    expect(verified.status).toBe(200)
  })
})

describe('V2 closed sign-up and server side creation', () => {
  test('public sign-up is closed over http', async () => {
    const res = await m.httpPost('/sign-up/email', {
      email: 'chiuso@example.test',
      password: PASSWORD,
      name: 'X',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await m.countRows('users', { email: 'chiuso@example.test' })).toBe(0)
  })
  test('server side signUpEmail is refused too: activation uses the internal adapter', async () => {
    // Observed on 1.7.10 (ADR 012, V2): disableSignUp also closes auth.api.signUpEmail.
    await expect(
      m.auth.api.signUpEmail({
        body: { email: 'lato-server@example.test', password: PASSWORD, name: 'X' },
      }),
    ).rejects.toThrow(/sign up is not enabled/i)
  })
  test('internal adapter creates a user with our id and a credential account', async () => {
    const { id, email } = await newUser()
    const row = await m.rawRow('users', { id })
    expect(row['id']).toBe(id)
    const signed = await m.auth.api.signInEmail({ body: { email, password: PASSWORD } })
    expect(signed.user.id).toBe(id)
  })
})

describe('V3 failed attempts seen by hooks', () => {
  test('after hook sees a failed sign-in with the attempted email', async () => {
    const seen: { path: string; email: string | undefined; failed: boolean }[] = []
    const a = minimalAuth(contract.pool, {
      hooks: {
        after: createAuthMiddleware((ctx) => {
          seen.push({
            path: ctx.path,
            email: (ctx.body as { email?: string } | undefined)?.email,
            failed: ctx.context.returned instanceof APIError,
          })
          return Promise.resolve()
        }),
      },
    })
    const { email } = await newUser(a)
    await a.httpPost('/sign-in/email', { email, password: `${PASSWORD}x` })
    expect(seen).toContainEqual({ path: '/sign-in/email', email, failed: true })
  })
  test('after hook sees a failed totp verification', async () => {
    const seen: { path: string; failed: boolean }[] = []
    const a = minimalAuth(contract.pool, {
      hooks: {
        after: createAuthMiddleware((ctx) => {
          seen.push({ path: ctx.path, failed: ctx.context.returned instanceof APIError })
          return Promise.resolve()
        }),
      },
    })
    const { email } = await newUser(a)
    const { cookie } = await signIn(a, email)
    await a.httpPost('/two-factor/enable', { password: PASSWORD }, cookie)
    await a.httpPost('/two-factor/verify-totp', { code: '000000' }, cookie)
    expect(seen).toContainEqual({ path: '/two-factor/verify-totp', failed: true })
  })
})

describe('V4 session token at rest', () => {
  test('session token is stored in clear (accepted, ADR 012)', async () => {
    const { id, email } = await newUser()
    const { token } = await m.auth.api.signInEmail({ body: { email, password: PASSWORD } })
    expect((await m.rawRow('sessions', { user_id: id }))['token']).toBe(token)
  })
})

describe('V5 __Host- cookies', () => {
  const hostCookies = {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax' as const, path: '/' },
    cookies: {
      session_token: { name: '__Host-session' },
      two_factor: { name: '__Host-two-factor' },
      'better-auth-passkey': { name: '__Host-passkey-challenge' },
    },
  }
  test('custom __Host- session cookie is used verbatim and read back', async () => {
    const a = minimalAuth(contract.pool, { advanced: hostCookies })
    const { email } = await newUser(a)
    const { setCookies, cookie } = await signIn(a, email)
    const session = parseSetCookie(setCookies.find((c) => c.includes('session'))!)
    expect(session.name).toBe('__Host-session')
    expect(session.attributes.some((x) => x.startsWith('domain'))).toBe(false)
    expect(session.attributes).toEqual(expect.arrayContaining(['path=/', 'secure', 'httponly']))
    const read = await a.auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(read).not.toBeNull()
  })
  test('useSecureCookies true would add a second prefix', async () => {
    const a = minimalAuth(contract.pool, {
      advanced: { useSecureCookies: true, cookies: { session_token: { name: '__Host-session' } } },
    })
    const { email } = await newUser(a)
    const { setCookies } = await signIn(a, email)
    expect(setCookies.find((c) => c.includes('session'))).toMatch(/^__Secure-__Host-session=/)
  })
  test('two factor challenge cookie name under __Host-', async () => {
    const a = minimalAuth(contract.pool, { advanced: hostCookies })
    const { email } = await newUser(a)
    const first = await signIn(a, email)
    const enable = await a.httpPost('/two-factor/enable', { password: PASSWORD }, first.cookie)
    const secret = secretOf(((await enable.json()) as { totpURI: string }).totpURI)
    await a.httpPost('/two-factor/verify-totp', { code: totpCode(secret) }, first.cookie)
    const login = await a.httpPost('/sign-in/email', { email, password: PASSWORD })
    // the challenge cookie keeps the library name unless it is named explicitly in advanced.cookies
    expect(login.headers.getSetCookie().map((c) => c.split('=')[0])).toContain('__Host-two-factor')
    expect(await login.json()).toMatchObject({ twoFactorRedirect: true })
  })
  test('passkey challenge cookie accepts a __Host- name too', async () => {
    const a = minimalAuth(contract.pool, { advanced: hostCookies })
    const { email } = await newUser(a)
    const { cookie } = await signIn(a, email)
    const res = await a.auth.handler(
      new Request(`${CONTRACT_ORIGIN}/api/auth/passkey/generate-register-options`, {
        headers: { cookie, origin: CONTRACT_ORIGIN },
      }),
    )
    expect(res.status).toBe(200)
    const challenge = res.headers.getSetCookie().find((c) => c.includes('passkey'))!
    expect(challenge).toMatch(/^__Host-passkey-challenge=/)
    expect(challenge).toMatch(/Path=\//i)
    expect(challenge).not.toMatch(/domain=/i)
  })
})

describe('V6 ids, tables and reset link capture', () => {
  test('ids come from IdGenerator and tables are plural', async () => {
    const { id } = await newUser()
    expect(id).toMatch(uuidV7Re)
    const { email } = await newUser()
    const signed = await m.auth.api.signInEmail({ body: { email, password: PASSWORD } })
    expect((await m.rawRow('sessions', { token: signed.token }))['id']).toMatch(uuidV7Re)
  })
  test('password reset url can be captured instead of mailed', async () => {
    let captured: string | undefined
    const a = minimalAuth(contract.pool, {
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: ({ url }) => {
          captured = url
          return Promise.resolve()
        },
      },
    })
    const { id, email } = await newUser(a)
    await signIn(a, email)
    await a.auth.api.requestPasswordReset({ body: { email, redirectTo: '/reimposta' } })
    expect(captured).toContain('/reset-password/')
    const token = new URL(captured!).pathname.split('/').pop()!
    await a.auth.api.resetPassword({ body: { token, newPassword: 'una-nuova-password-lunga' } })
    expect(await a.countRows('sessions', { user_id: id })).toBe(0)
  })
})

describe('V7 totp check without a session', () => {
  test('verify-totp replaces the session: it is not a neutral reconfirmation', async () => {
    const { id, email } = await newUser()
    const { cookie } = await signIn(m, email)
    const enable = await m.httpPost('/two-factor/enable', { password: PASSWORD }, cookie)
    const secret = secretOf(((await enable.json()) as { totpURI: string }).totpURI)
    const before = (await contract.pool.query('select id from sessions where user_id = $1', [id]))
      .rows
    const res = await m.httpPost('/two-factor/verify-totp', { code: totpCode(secret) }, cookie)
    const after = (await contract.pool.query('select id from sessions where user_id = $1', [id]))
      .rows
    expect(res.status).toBe(200)
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(before[0].id)
  })
})

describe('V8 session opened server side', () => {
  test('a session opened by a plugin endpoint yields the cookie of a real sign-in', async () => {
    const openSession = {
      id: 'contract-open-session',
      endpoints: {
        openSession: createAuthEndpoint(
          '/contract/open-session',
          { method: 'POST', body: z.object({ userId: z.string() }) },
          async (ctx) => {
            const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId)
            // overrideAll: without it the default additional field values win over the override
            const session = await ctx.context.internalAdapter.createSession(
              user!.id,
              false,
              { authMethod: 'activation' } as never,
              true,
            )
            await setSessionCookie(ctx, { session, user: user! })
            return ctx.json({ ok: true })
          },
        ),
      },
    }
    const a = minimalAuth(contract.pool, {
      plugins: [...(minimalAuth(contract.pool).auth.options.plugins ?? []), openSession],
    })
    const { id, email } = await newUser(a)
    const opened = await (a.auth.api as unknown as OpenSessionApi).openSession({
      body: { userId: id },
      returnHeaders: true,
    })
    const ours = parseSetCookie(opened.headers.getSetCookie().find((c) => c.includes('session'))!)
    const theirs = parseSetCookie(
      (await signIn(a, email)).setCookies.find((c) => c.includes('session'))!,
    )
    expect(ours.name).toBe(theirs.name)
    expect(
      ours.attributes.filter((x) => !x.startsWith('max-age') && !x.startsWith('expires')),
    ).toEqual(theirs.attributes.filter((x) => !x.startsWith('max-age') && !x.startsWith('expires')))
    expect(ours.value).toMatch(/^[^.]+\.[^.]+$/)
    const got = await a.auth.api.getSession({
      headers: new Headers({ cookie: `${ours.name}=${ours.value}` }),
    })
    expect(got!.session.userId).toBe(id)
    expect((got!.session as unknown as { authMethod: string }).authMethod).toBe('activation')
  })
  test('a tampered signature is refused', async () => {
    const { email } = await newUser()
    const { setCookies } = await signIn(m, email)
    const c = parseSetCookie(setCookies.find((x) => x.includes('session_token'))!)
    const bad = c.value.slice(0, -1) + (c.value.endsWith('A') ? 'B' : 'A')
    const got = await m.auth.api.getSession({
      headers: new Headers({ cookie: `${c.name}=${bad}` }),
    })
    expect(got).toBeNull()
  })
})

describe('V9 verify-totp during enrolment', () => {
  test('which session survives', async () => {
    const { id, email } = await newUser()
    const first = await signIn(m, email)
    const beforeIds = (
      await contract.pool.query('select id from sessions where user_id = $1', [id])
    ).rows.map((r) => r.id)
    const enable = await m.httpPost('/two-factor/enable', { password: PASSWORD }, first.cookie)
    const secret = secretOf(((await enable.json()) as { totpURI: string }).totpURI)
    const res = await m.httpPost(
      '/two-factor/verify-totp',
      { code: totpCode(secret) },
      first.cookie,
    )
    const after = (
      await contract.pool.query('select id, auth_method from sessions where user_id = $1', [id])
    ).rows
    expect(res.status).toBe(200)
    // a new session replaces the old one and starts with the default method: databaseHooks must set it (Task 9)
    expect(res.headers.getSetCookie().some((c) => c.includes('session_token'))).toBe(true)
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(beforeIds[0])
    expect(after[0].auth_method).toBe('password')
  })
})

describe('V10 before hook on server side calls', () => {
  test('does it run and is ctx.request set', async () => {
    const seen: { path: string; hasRequest: boolean }[] = []
    const a = minimalAuth(contract.pool, {
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        sendResetPassword: () => Promise.resolve(),
      },
      hooks: {
        before: createAuthMiddleware((ctx) => {
          seen.push({ path: ctx.path, hasRequest: ctx.request instanceof Request })
          return Promise.resolve()
        }),
      },
    })
    const { email } = await newUser(a)
    await a.auth.api.requestPasswordReset({ body: { email, redirectTo: '/reimposta' } })
    await a.httpPost('/request-password-reset', { email, redirectTo: '/reimposta' })
    const mine = seen.filter((s) => s.path === '/request-password-reset')
    expect(mine).toEqual([
      { path: '/request-password-reset', hasRequest: false },
      { path: '/request-password-reset', hasRequest: true },
    ])
  })
})
