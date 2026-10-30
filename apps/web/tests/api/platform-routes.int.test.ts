import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { MAIL_FAILURE_KINDS } from '@app/application'
import { apiRoutes, MailTestKind } from '@app/contracts'
import type { ApiContract } from '@app/contracts'
import type { ErrorJson } from './identity-env.js'
import {
  PLACEHOLDER_IDS,
  routeKey,
  sampleBody,
  secretsIn,
  startIsolationFixture,
} from './support/isolation-fixture.js'
import type { IsolationFixture } from './support/isolation-fixture.js'

// The platform administrator's routes: the system email (ADR 017). For anyone else they do not
// exist (404); a change needs a recent reauth; the password never comes back.

let fx: IsolationFixture
let platformCookie: string
let platformUserId: string

const platformRoutes = apiRoutes.filter((r) => r.scope === 'platform')
const PASSWORD_SENT = 'parola-della-batteria'
/** The DTO says a password is stored with this key, never its value. */
const ALLOWED_KEYS = ['passwordSet']

beforeAll(async () => {
  fx = await startIsolationFixture('platform')
  const own = await fx.env.agency()
  const person = await fx.env.person(own.id, 'member')
  platformUserId = person.userId
  await fx.env.admin.pool.query("update users set platform_role = 'admin' where id = $1", [
    person.userId,
  ])
  await fx.env.addPasskey(person.userId)
  platformCookie = await fx.env.strongSignIn(person)
}, 300_000)

afterAll(async () => {
  await fx.env.stop()
})

beforeEach(async () => {
  await fx.refreshReauth()
  await fx.env.admin.pool.query("delete from rate_limit_counters where key like '%mail-test%'")
})

const call = (route: ApiContract, cookie: string, body = sampleBody(route, PLACEHOLDER_IDS)) =>
  fx.env.call(route.method, route.path, body, { cookie })

const route = (key: string) => {
  const found = platformRoutes.find((r) => routeKey(r) === key)
  if (!found) throw new Error(`no platform route ${key}`)
  return found
}
const GET = route('GET /api/v1/platform/mail-settings')
const PUT = route('PUT /api/v1/platform/mail-settings')
const TEST = route('POST /api/v1/platform/mail-settings/test')

test('the platform routes are these three', () => {
  expect(platformRoutes.map(routeKey).sort()).toEqual([
    'GET /api/v1/platform/mail-settings',
    'POST /api/v1/platform/mail-settings/test',
    'PUT /api/v1/platform/mail-settings',
  ])
})

test('the contract knows every kind of test result the use case gives', () => {
  expect([...MailTestKind.options].sort()).toEqual(
    ['sent', 'not_configured', 'unexpected', ...MAIL_FAILURE_KINDS].sort(),
  )
})

const AGENCY_PEOPLE = ['owner', 'admin', 'viewer', 'ownerOfB', 'memberOfB'] as const

test.each(
  platformRoutes.flatMap((r) =>
    AGENCY_PEOPLE.map((who) => ({ who, method: r.method, path: r.path })),
  ),
)('$who $method $path → 404, nothing changed', async ({ who, method, path }) => {
  const r = platformRoutes.find((x) => x.method === method && x.path === path)
  if (!r) throw new Error('route')
  const before = await fx.env.admin.pool.query('select count(*)::int as n from integrations')
  const answer = await call(r, fx.cookies[who])
  const text = await answer.text()
  expect(answer.status, text).toBe(404)
  expect((JSON.parse(text) as ErrorJson).error.code).toBe('NOT_FOUND')
  expect(text).not.toMatch(/smtp|mail/i)
  const after = await fx.env.admin.pool.query('select count(*)::int as n from integrations')
  expect(after.rows).toEqual(before.rows)
})

test.each(platformRoutes)('without a session $method $path → 401', async (r) => {
  const answer = await fx.env.call(r.method, r.path, sampleBody(r, PLACEHOLDER_IDS))
  expect(answer.status).toBe(401)
})

test('the administrator: nothing set, then set, read back without the password', async () => {
  const empty = await call(GET, platformCookie)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toEqual({ settings: null })

  const put = await call(PUT, platformCookie)
  const text = await put.text()
  expect(put.status, text).toBe(200)
  expect(text).not.toContain(PASSWORD_SENT)
  expect(secretsIn(text, ALLOWED_KEYS)).toEqual([])
  const { settings } = JSON.parse(text) as { settings: Record<string, unknown> }
  expect(settings).toMatchObject({
    host: 'smtp.feedway.test',
    port: 587,
    security: 'starttls',
    passwordSet: true,
    verifiedAt: null,
  })
  expect(Object.keys(settings).sort()).toEqual([
    'from',
    'host',
    'passwordSet',
    'port',
    'security',
    'updatedAt',
    'username',
    'verifiedAt',
  ])

  const read = await call(GET, platformCookie)
  const readText = await read.text()
  expect(readText).not.toContain(PASSWORD_SENT)
  expect(secretsIn(readText, ALLOWED_KEYS)).toEqual([])
  expect((JSON.parse(readText) as { settings: unknown }).settings).toEqual(settings)

  const { rows } = await fx.env.admin.pool.query<{ actor_id: string; source: string; ip: unknown }>(
    "select actor_id, source, data from audit_log where action = 'platform.mail_settings_changed'",
  )
  expect(rows).toEqual([expect.objectContaining({ actor_id: platformUserId, source: 'panel' })])
})

test('the test email leaves and marks the settings verified', async () => {
  const answer = await call(TEST, platformCookie)
  const text = await answer.text()
  expect(answer.status, text).toBe(200)
  expect(JSON.parse(text)).toEqual({ ok: true, kind: 'sent', response: null })
  const read = (await (await call(GET, platformCookie)).json()) as {
    settings: { verifiedAt: string | null }
  }
  expect(read.settings.verifiedAt).toMatch(/^\d{4}-/)
})

test('a change or a test needs a recent reauth; reading does not', async () => {
  await fx.env.admin.pool.query(
    'update sessions set reauthenticated_at = null where user_id = $1',
    [platformUserId],
  )
  for (const r of [PUT, TEST]) {
    const answer = await call(r, platformCookie)
    const text = await answer.text()
    expect(answer.status, `${routeKey(r)}: ${text}`).toBe(403)
    expect((JSON.parse(text) as ErrorJson).error.code).toBe('REAUTH_REQUIRED')
  }
  expect((await call(GET, platformCookie)).status).toBe(200)
})

test('the role is read at every request: a demoted administrator gets 404', async () => {
  await fx.env.admin.pool.query('update users set platform_role = null where id = $1', [
    platformUserId,
  ])
  try {
    for (const r of platformRoutes) expect((await call(r, platformCookie)).status).toBe(404)
  } finally {
    await fx.env.admin.pool.query("update users set platform_role = 'admin' where id = $1", [
      platformUserId,
    ])
  }
})

test('bodies are checked: unknown keys, a port outside the list, an empty password', async () => {
  const base = sampleBody(PUT, PLACEHOLDER_IDS) as Record<string, unknown>
  for (const body of [
    { ...base, secret: 'altro' },
    { ...base, port: 25 },
    { ...base, password: '' },
    { ...base, host: 'non un host' },
  ]) {
    const answer = await call(PUT, platformCookie, body)
    const text = await answer.text()
    expect(answer.status, JSON.stringify(body)).toBe(422)
    expect(text).not.toContain('altro')
  }
  for (const to of ['a@b.test, c@d.test', 'Nome <a@b.test>']) {
    const answer = await call(TEST, platformCookie, { to })
    // text that looks like HTML is refused before validation (400)
    expect([400, 422], to).toContain(answer.status)
  }
})

test('the test email is limited for each administrator', async () => {
  const statuses: number[] = []
  for (let i = 0; i < 6; i++) statuses.push((await call(TEST, platformCookie)).status)
  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
  expect(statuses[5]).toBe(429)
})

test('people of an agency behind the same address never use up the administrator’s limit', async () => {
  const sameAddress = { 'x-forwarded-for': '10.99.0.1' }
  for (let i = 0; i < 6; i++) {
    const r = await fx.env.call(TEST.method, TEST.path, sampleBody(TEST, PLACEHOLDER_IDS), {
      cookie: fx.cookies.owner,
      headers: sameAddress,
    })
    expect(r.status).toBe(404)
  }
  const mine = await fx.env.call(TEST.method, TEST.path, sampleBody(TEST, PLACEHOLDER_IDS), {
    cookie: platformCookie,
    headers: sameAddress,
  })
  expect(mine.status, await mine.text()).toBe(200)
})
