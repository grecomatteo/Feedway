import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createDb } from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { startWeb } from './helpers.js'
import type { RunningWeb } from './helpers.js'

const PANEL = 'https://pannello.example.ts.net'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'

let tdb: TestDatabase
let web: RunningWeb
let admin: DbHandle

beforeAll(async () => {
  tdb = await startTestDatabase()
  admin = createDb(tdb.adminUrl, { max: 2, applicationName: 'links-web-test' })
  web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: PANEL,
  })
}, 300_000)

afterAll(async () => {
  await web.stop()
  await admin.close()
  await tdb.stop()
})

async function invite(email: string, role: 'member' | 'admin' = 'member') {
  const token = randomBytes(32).toString('base64url')
  const { organizationId, workspaceId } = await seed(tdb.runtimeUrl, async (s) => {
    const organizationId = await s.organization()
    return { organizationId, workspaceId: await s.workspace(organizationId) }
  })
  await admin.pool.query(
    `insert into invites (id, organization_id, purpose, email, token_hash, org_role, memberships, expires_at)
     values ($1, $2, 'invite', $3, $4, $5, $6, now() + interval '1 hour')`,
    [
      randomUUID(),
      organizationId,
      email,
      createHash('sha256').update(token, 'utf8').digest(),
      role,
      JSON.stringify([{ workspaceId, role: 'editor' }]),
    ],
  )
  return { token, organizationId }
}

function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(web.url(path), {
    method,
    headers: {
      'content-type': 'application/json',
      origin: PANEL,
      'x-app-request': '1',
      ...headers,
    },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-session='))
    ?.split(';')[0]

test('the activation page reads the link, activates the account and gets a working session', async () => {
  const email = `invito-${randomUUID().slice(0, 8)}@esempio.it`
  const { token } = await invite(email)
  const described = await call('GET', `/api/v1/links/${token}`, undefined, {
    'x-forwarded-for': '6.6.6.1',
  })
  expect(described.status).toBe(200)
  expect(await described.json()).toMatchObject({ purpose: 'invite', email, existingUser: false })

  const activated = await call(
    'POST',
    `/api/v1/links/${token}/activate`,
    { name: 'Persona Nuova', password: PASSWORD },
    { 'x-forwarded-for': '6.6.6.1' },
  )
  expect(activated.status).toBe(200)
  expect(await activated.json()).toMatchObject({ next: 'done' })
  const cookie = sessionCookie(activated)
  expect(cookie).toBeDefined()
  const session = await fetch(web.url('/api/auth/get-session'), {
    headers: { cookie: cookie ?? '' },
  })
  expect(((await session.json()) as { user?: { email?: string } } | null)?.user?.email).toBe(email)

  const again = await call('POST', `/api/v1/links/${token}/activate`, {
    name: 'Persona Nuova',
    password: PASSWORD,
  })
  expect(again.status).toBe(410)
})

test('a weak password answers 422 with the field, an unknown link 410', async () => {
  const { token } = await invite(`debole-${randomUUID().slice(0, 8)}@esempio.it`)
  const weak = await call('POST', `/api/v1/links/${token}/activate`, {
    name: 'Persona',
    password: 'passwordpassword',
  })
  expect(weak.status).toBe(422)
  expect(await weak.json()).toMatchObject({
    error: { code: 'VALIDATION', issues: [{ path: ['password'] }] },
  })
  expect((await call('GET', '/api/v1/links/sconosciuto')).status).toBe(410)
})

test('completing without a session answers 401', async () => {
  const { token } = await invite(`pk-${randomUUID().slice(0, 8)}@esempio.it`)
  expect((await call('POST', `/api/v1/links/${token}/complete`, {})).status).toBe(401)
})

test('activation needs the panel origin and the app header', async () => {
  const { token } = await invite(`csrf-${randomUUID().slice(0, 8)}@esempio.it`)
  const body = { name: 'Persona', password: PASSWORD }
  expect(
    (
      await call('POST', `/api/v1/links/${token}/activate`, body, {
        origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await fetch(web.url(`/api/v1/links/${token}/activate`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: PANEL },
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(403)
})

test('the link routes allow twenty requests a minute per address', async () => {
  for (let n = 0; n < 20; n++) {
    const r = await call('GET', '/api/v1/links/sconosciuto', undefined, {
      'x-forwarded-for': '6.6.6.9',
    })
    expect(r.status).toBe(410)
  }
  const blocked = await call('GET', '/api/v1/links/sconosciuto', undefined, {
    'x-forwarded-for': '6.6.6.9',
  })
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
})

test('a passkey activation left halfway goes on only with a way to sign in', async () => {
  const email = `meta-${randomUUID().slice(0, 8)}@esempio.it`
  const { token } = await invite(email, 'admin')
  const ip = { 'x-forwarded-for': '6.6.6.7' }
  const started = await call(
    'POST',
    `/api/v1/links/${token}/activate`,
    { name: 'Persona Nuova', password: null },
    ip,
  )
  expect(await started.json()).toMatchObject({ next: 'register_passkey' })
  const cookie = sessionCookie(started) ?? ''
  const withSession = { ...ip, cookie }

  // the passkey never came: no second factor next to no first one, and the link stays open
  const totp = await call('POST', '/api/auth/two-factor/enable', {}, withSession)
  expect(totp.status).toBe(403)
  expect(await totp.json()).toMatchObject({ code: 'PRIMARY_METHOD_REQUIRED' })
  expect((await call('POST', `/api/v1/links/${token}/complete`, {}, withSession)).status).toBe(409)
  const open = await admin.pool.query<{ used_at: Date | null }>(
    'select used_at from invites where email = $1',
    [email],
  )
  expect(open.rows[0]?.used_at).toBeNull()

  // the same session sets a password instead: the link is used from now on
  const password = await call(
    'POST',
    `/api/v1/links/${token}/activate`,
    { name: 'Persona Nuova', password: PASSWORD },
    withSession,
  )
  expect(password.status).toBe(200)
  expect(await password.json()).toMatchObject({ next: 'done' })
  const used = await admin.pool.query<{ used_at: Date | null }>(
    'select used_at from invites where email = $1',
    [email],
  )
  expect(used.rows[0]?.used_at).not.toBeNull()
  const after = { ...ip, cookie: sessionCookie(password) ?? cookie }
  expect(
    (await call('POST', '/api/auth/two-factor/enable', { password: PASSWORD }, after)).status,
  ).toBe(200)
})

/** A member activated without a password whose passkey never came: their session cookie. */
async function withoutWayIn() {
  const email = `senza-${randomUUID().slice(0, 8)}@esempio.it`
  const { token } = await invite(email)
  const started = await call('POST', `/api/v1/links/${token}/activate`, {
    name: 'Persona Nuova',
    password: null,
  })
  expect(await started.json()).toMatchObject({ next: 'register_passkey' })
  const { rows } = await admin.pool.query<{ id: string }>('select id from users where email = $1', [
    email,
  ])
  return { email, token, userId: rows[0]?.id ?? '', cookie: sessionCookie(started) ?? '' }
}

const signInWith = (email: string, password: string) =>
  call('POST', '/api/auth/sign-in/email', { email, password }, { 'x-forwarded-for': '6.6.7.1' })

test('an account with no way in sets its password with the session alone', async () => {
  const p = await withoutWayIn()
  const weak = await call(
    'POST',
    '/api/v1/me/password',
    { password: 'password' },
    { cookie: p.cookie },
  )
  expect(weak.status).toBe(422)
  expect(await weak.json()).toMatchObject({ error: { issues: [{ path: ['password'] }] } })
  const set = await call(
    'POST',
    '/api/v1/me/password',
    { password: PASSWORD },
    { cookie: p.cookie },
  )
  expect(set.status).toBe(200)
  const signedIn = await signInWith(p.email, PASSWORD)
  expect(signedIn.status).toBe(200)
  // signed in with the password: the activation session is over
  expect((await call('GET', '/api/v1/me', undefined, { cookie: p.cookie })).status).toBe(401)
  const cookie = sessionCookie(signedIn) ?? ''
  // only once: from now on the password changes with the current one
  const again = await call('POST', '/api/v1/me/password', { password: PASSWORD }, { cookie })
  expect(again.status).toBe(409)
  // the link still open does not change it either: that takes the current password
  const relink = await call(
    'POST',
    `/api/v1/links/${p.token}/activate`,
    { name: 'Persona Nuova', password: 'un-altra-frase-lunga-e-sicura' },
    { cookie },
  )
  expect(relink.status).toBe(409)
  expect((await signInWith(p.email, PASSWORD)).status).toBe(200)
})

test('with passkeys only, setting a password needs a recent confirmation', async () => {
  const p = await withoutWayIn()
  await admin.pool.query(
    `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
     values ($1, 'Portatile', 'chiave-finta', $2, $3, 0, 'multiDevice', true, now())`,
    [randomUUID(), p.userId, randomBytes(16).toString('base64url')],
  )
  const refused = await call(
    'POST',
    '/api/v1/me/password',
    { password: PASSWORD },
    { cookie: p.cookie },
  )
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({ error: { code: 'REAUTH_REQUIRED' } })
  await admin.pool.query('update sessions set reauthenticated_at = now() where user_id = $1', [
    p.userId,
  ])
  expect(
    (await call('POST', '/api/v1/me/password', { password: PASSWORD }, { cookie: p.cookie }))
      .status,
  ).toBe(200)
  expect((await signInWith(p.email, PASSWORD)).status).toBe(200)
  const audit = await admin.pool.query<{ action: string }>(
    "select action from audit_log where actor_id = $1 and action = 'auth.password_changed'",
    [p.userId],
  )
  expect(audit.rowCount).toBe(1)
})
