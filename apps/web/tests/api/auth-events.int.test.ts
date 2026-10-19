import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createDb, createPasswordHasher } from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { startWeb } from './helpers.js'
import type { RunningWeb } from './helpers.js'

const PANEL = 'https://pannello.example.ts.net'
const PASSWORD = 'una-password-molto-lunga-1'

let tdb: TestDatabase
let web: RunningWeb
let admin: DbHandle

beforeAll(async () => {
  tdb = await startTestDatabase()
  admin = createDb(tdb.adminUrl, { max: 2, applicationName: 'auth-events-web-test' })
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

async function newUser() {
  const email = `pannello-${randomUUID().slice(0, 8)}@example.test`
  const id = await seed(tdb.runtimeUrl, (s) => s.user({ email }))
  await admin.pool.query(
    `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
     values ($1, $2::text, 'credential', $2::uuid, $3, now())`,
    [randomUUID(), id, await createPasswordHasher().hash(PASSWORD)],
  )
  return { id, email }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(web.url(path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: PANEL,
      'x-app-request': '1',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const deviceCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-device='))
    ?.split(';')[0]

test('a panel sign-in is audited with the proxy address and the device cookie, not a forged header', async () => {
  const { id, email } = await newUser()
  const first = await post(
    '/api/auth/sign-in/email',
    { email, password: PASSWORD },
    { 'x-forwarded-for': '1.2.3.4, 93.41.12.200', 'x-app-device-id': 'forged-1' },
  )
  expect(first.status).toBe(200)
  const cookie = deviceCookie(first)
  expect(cookie).toBeDefined()
  // same browser cookie, a different forged header: still one known device
  const second = await post(
    '/api/auth/sign-in/email',
    { email, password: PASSWORD },
    { cookie: cookie ?? '', 'x-forwarded-for': '93.41.12.200', 'x-app-device-id': 'forged-2' },
  )
  expect(second.status).toBe(200)
  const devices = await admin.pool.query('select 1 from known_devices where user_id = $1', [id])
  expect(devices.rowCount).toBe(1)
  const audit = await admin.pool.query<{ action: string; ip: string }>(
    'select action, host(ip) as ip from audit_log where actor_id = $1 order by id',
    [id],
  )
  expect(audit.rows).toEqual([
    { action: 'auth.login', ip: '93.41.12.200' },
    { action: 'auth.login', ip: '93.41.12.200' },
  ])
})

test('the lock link answers 410 when invalid and needs the panel origin', async () => {
  const invalid = await post(
    '/api/v1/security/lock',
    { token: 'non-un-token' },
    { 'x-forwarded-for': '5.5.5.1' },
  )
  expect(invalid.status).toBe(410)
  expect(await invalid.json()).toMatchObject({ error: { code: 'LINK_INVALID' } })
  const foreign = await post(
    '/api/v1/security/lock',
    { token: 'non-un-token' },
    { origin: 'https://evil.example' },
  )
  expect(foreign.status).toBe(403)
})

test('the lock link is limited to five attempts a minute per address', async () => {
  for (let n = 0; n < 5; n++) {
    const r = await post(
      '/api/v1/security/lock',
      { token: `t${String(n)}` },
      { 'x-forwarded-for': '5.5.5.2' },
    )
    expect(r.status).toBe(410)
  }
  const blocked = await post(
    '/api/v1/security/lock',
    { token: 't6' },
    { 'x-forwarded-for': '5.5.5.2' },
  )
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
})
