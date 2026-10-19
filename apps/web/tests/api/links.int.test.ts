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

async function invite(email: string) {
  const token = randomBytes(32).toString('base64url')
  const { organizationId, workspaceId } = await seed(tdb.runtimeUrl, async (s) => {
    const organizationId = await s.organization()
    return { organizationId, workspaceId: await s.workspace(organizationId) }
  })
  await admin.pool.query(
    `insert into invites (id, organization_id, purpose, email, token_hash, org_role, memberships, expires_at)
     values ($1, $2, 'invite', $3, $4, 'member', $5, now() + interval '1 hour')`,
    [
      randomUUID(),
      organizationId,
      email,
      createHash('sha256').update(token, 'utf8').digest(),
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
    error: { code: 'VALIDATION', details: { field: 'password' } },
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
