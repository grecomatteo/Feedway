import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { MAIL_FAILURE_KINDS } from '@app/application'
import { apiRoutes, MailTestKind } from '@app/contracts'
import { TELEGRAM_MOCK } from '@app/telegram-mock'
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
const BOT = route('GET /api/v1/platform/telegram-bot')
const SET_BOT = route('PUT /api/v1/platform/telegram-bot')
const REMOVE_BOT = route('DELETE /api/v1/platform/telegram-bot')
const MONITORING = route('GET /api/v1/platform/monitoring')
const SET_WATCH = route('PUT /api/v1/platform/external-watch')
const REMOVE_WATCH = route('DELETE /api/v1/platform/external-watch')
const TEST_WATCH = route('POST /api/v1/platform/external-watch/test')

test('the platform routes are the system email, the Telegram bot and the monitoring', () => {
  expect(platformRoutes.map(routeKey).sort()).toEqual([
    'DELETE /api/v1/platform/external-watch',
    'DELETE /api/v1/platform/telegram-bot',
    'GET /api/v1/platform/mail-settings',
    'GET /api/v1/platform/monitoring',
    'GET /api/v1/platform/telegram-bot',
    'POST /api/v1/platform/external-watch/test',
    'POST /api/v1/platform/mail-settings/test',
    'PUT /api/v1/platform/external-watch',
    'PUT /api/v1/platform/mail-settings',
    'PUT /api/v1/platform/telegram-bot',
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
  expect(text).not.toMatch(/smtp|mail|telegram|bot|worker|watch/i)
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
  for (const r of [PUT, TEST, SET_BOT, REMOVE_BOT, SET_WATCH, REMOVE_WATCH]) {
    const answer = await call(r, platformCookie)
    const text = await answer.text()
    expect(answer.status, `${routeKey(r)}: ${text}`).toBe(403)
    expect((JSON.parse(text) as ErrorJson).error.code).toBe('REAUTH_REQUIRED')
  }
  expect((await call(GET, platformCookie)).status).toBe(200)
  expect((await call(MONITORING, platformCookie)).status).toBe(200)
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

test('the Telegram bot: tried with getMe, saved with its name, the token never comes back', async () => {
  expect(await (await call(BOT, platformCookie)).json()).toEqual({ bot: null })
  const set = await call(SET_BOT, platformCookie, {
    token: ` ${TELEGRAM_MOCK.bots.platform.token}\n`,
  })
  const text = await set.text()
  expect(set.status, text).toBe(200)
  expect(text).not.toContain(TELEGRAM_MOCK.bots.platform.token)
  const { bot } = JSON.parse(text) as { bot: Record<string, unknown> }
  expect(bot).toMatchObject({ botUsername: 'feedway_mock_bot', rejectedAt: null })
  expect(bot.verifiedAt).toEqual(expect.any(String))
  expect(Object.keys(bot).sort()).toEqual(['botUsername', 'rejectedAt', 'updatedAt', 'verifiedAt'])
  const read = await call(BOT, platformCookie)
  expect(((await read.json()) as { bot: unknown }).bot).toEqual(bot)
  expect(fx.env.telegram.calls().map((c) => [c.method, c.bot])).toContainEqual([
    'getMe',
    'feedway_mock_bot',
  ])
  const { rows } = await fx.env.admin.pool.query<{ data: unknown }>(
    "select data from audit_log where action = 'platform.telegram_bot_changed'",
  )
  expect(rows.map((r) => r.data)).toEqual([{ botUsername: 'feedway_mock_bot' }])
})

test('a token Telegram refuses, or one of the wrong form, is not saved', async () => {
  const before = await (await call(BOT, platformCookie)).text()
  for (const token of ['non-un-token', '1000000009:AAtoken-che-telegram-non-conosce-000']) {
    const answer = await call(SET_BOT, platformCookie, { token })
    const text = await answer.text()
    expect(answer.status, text).toBe(422)
    expect(JSON.parse(text)).toMatchObject({ error: { issues: [{ path: ['token'] }] } })
    expect(text).not.toContain(token)
  }
  expect(await (await call(BOT, platformCookie)).text()).toBe(before)
})

test('Telegram down: 502, nothing saved', async () => {
  fx.env.telegram.unavailable()
  const answer = await call(SET_BOT, platformCookie, { token: TELEGRAM_MOCK.bots.agency.token })
  expect(answer.status).toBe(502)
  expect(
    ((await (await call(BOT, platformCookie)).json()) as { bot: { botUsername: string } }).bot
      .botUsername,
  ).toBe('feedway_mock_bot')
})

test('the bot taken away: none any more, and taking it away again is fine', async () => {
  expect((await call(REMOVE_BOT, platformCookie)).status).toBe(200)
  expect(await (await call(BOT, platformCookie)).json()).toEqual({ bot: null })
  expect((await call(REMOVE_BOT, platformCookie)).status).toBe(200)
  const { rows } = await fx.env.admin.pool.query<{ data: unknown }>(
    "select data from audit_log where action = 'platform.telegram_bot_removed'",
  )
  expect(rows.map((r) => r.data)).toEqual([{ botUsername: 'feedway_mock_bot' }])
})

// the address of the external watch is a secret: it goes in and never comes back
const WATCH_URL = 'https://127.0.0.1:1/ping/uuid-della-batteria'

test('the monitoring: each worker with its colour, the watch not set', async () => {
  await fx.env.admin.pool.query('delete from system_heartbeats')
  await fx.env.admin.pool.query(
    `insert into system_heartbeats (process, instance, last_beat_at, details) values
       ('worker', 'vivo', now() - interval '10 seconds', '{"version":"0.14.0","queues":30}'),
       ('worker', 'fermo', now() - interval '5 minutes', '{"version":"0.13.2","queues":30}')`,
  )
  const answer = await call(MONITORING, platformCookie)
  expect(answer.status).toBe(200)
  const body = (await answer.json()) as {
    workers: { instance: string; lastBeatAt: string; health: string; version: string | null }[]
    external: unknown
  }
  expect(body.external).toBeNull()
  expect(
    body.workers.map((w) => ({ instance: w.instance, health: w.health, version: w.version })),
  ).toEqual([
    { instance: 'vivo', health: 'ok', version: '0.14.0' },
    { instance: 'fermo', health: 'silent', version: '0.13.2' },
  ])
  expect(body.workers.every((w) => !Number.isNaN(Date.parse(w.lastBeatAt)))).toBe(true)
})

test('the external watch: an address that is not https is refused', async () => {
  const answer = await call(SET_WATCH, platformCookie, { url: 'http://hc-ping.com/abc' })
  const text = await answer.text()
  expect(answer.status, text).toBe(422)
  expect(text).toContain('https://')
})

test('the external watch: saved, tried, read back without its address', async () => {
  const put = await call(SET_WATCH, platformCookie, { url: WATCH_URL })
  expect(put.status, await put.text()).toBe(200)

  const tried = await call(TEST_WATCH, platformCookie, {})
  const triedText = await tried.text()
  expect(tried.status, triedText).toBe(200)
  expect(JSON.parse(triedText)).toMatchObject({
    configured: true,
    last: { ok: false, problem: 'network', status: null },
  })
  expect(triedText).not.toContain('uuid-della-batteria')

  const read = await call(MONITORING, platformCookie)
  const text = await read.text()
  expect(text).not.toContain('uuid-della-batteria')
  expect((JSON.parse(text) as { external: unknown }).external).toMatchObject({
    addressSet: true,
    last: { ok: false, problem: 'network' },
  })
  const { rows } = await fx.env.admin.pool.query<{ data: unknown }>(
    "select data from audit_log where action = 'platform.external_watch_changed'",
  )
  expect(rows.map((r) => r.data)).toEqual([{}])
})

test('the external watch taken away: nothing to call, and taking it away again is fine', async () => {
  expect((await call(REMOVE_WATCH, platformCookie)).status).toBe(200)
  const read = (await (await call(MONITORING, platformCookie)).json()) as { external: unknown }
  expect(read.external).toBeNull()
  expect(await (await call(TEST_WATCH, platformCookie, {})).json()).toEqual({
    configured: false,
    last: null,
  })
  expect((await call(REMOVE_WATCH, platformCookie)).status).toBe(200)
  const { rows } = await fx.env.admin.pool.query(
    "select 1 from audit_log where action = 'platform.external_watch_removed'",
  )
  expect(rows).toHaveLength(1)
})
