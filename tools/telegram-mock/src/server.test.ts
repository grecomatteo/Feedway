import { afterAll, beforeEach, expect, test } from 'vitest'
import { TELEGRAM_MOCK, startTelegramMock } from './index.ts'
import { visibleText } from './server.ts'

const mock = await startTelegramMock()
afterAll(() => mock.stop())
beforeEach(() => {
  mock.reset()
})

const { platform } = TELEGRAM_MOCK.bots
async function call(token: string, method: string, body: object = {}) {
  const res = await fetch(`${mock.url}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

test('getMe answers with the bot, an unknown or revoked token with 401', async () => {
  expect((await call(platform.token, 'getMe')).body).toMatchObject({
    ok: true,
    result: { is_bot: true, username: 'feedway_mock_bot' },
  })
  expect((await call('1:nope', 'getMe')).status).toBe(401)
  mock.revoke(platform.token)
  expect((await call(platform.token, 'getMe')).body).toMatchObject({
    ok: false,
    error_code: 401,
    description: 'Unauthorized',
  })
})

test('getUpdates returns what a person wrote and forgets what the offset confirms', async () => {
  mock.userWrites(platform.token, { chatId: 42, text: '/start abc' })
  const first = await call(platform.token, 'getUpdates', { offset: 0 })
  const result = first.body.result as { update_id: number; message: { text: string } }[]
  expect(result.map((u) => u.message.text)).toEqual(['/start abc'])
  const next = (result[0]?.update_id ?? 0) + 1
  expect((await call(platform.token, 'getUpdates', { offset: next })).body.result).toEqual([])
  expect((await call(platform.token, 'getUpdates', { offset: 0 })).body.result).toEqual([])
})

test('a long poll answers as soon as someone writes', async () => {
  const started = Date.now()
  const waiting = call(platform.token, 'getUpdates', { offset: 0, timeout: 5 })
  setTimeout(() => {
    mock.userWrites(platform.token, { chatId: 7, text: '/oggi' })
  }, 50)
  const { body } = await waiting
  expect((body.result as unknown[]).length).toBe(1)
  expect(Date.now() - started).toBeLessThan(3000)
})

test('setMyCommands keeps the menu of the bot; a name Telegram refuses answers 400', async () => {
  const menu = [{ command: 'oggi', description: 'I post di oggi' }]
  expect((await call(platform.token, 'setMyCommands', { commands: menu })).status).toBe(200)
  expect(mock.commands()).toEqual({ feedway_mock_bot: menu })
  const wrong = [{ command: '/Oggi', description: 'I post di oggi' }]
  expect((await call(platform.token, 'setMyCommands', { commands: wrong })).status).toBe(400)
  expect(mock.commands()).toEqual({ feedway_mock_bot: menu })
})

test('sendMessage records the message; a blocked chat answers 403', async () => {
  expect((await call(platform.token, 'sendMessage', { chat_id: 42, text: 'Ciao' })).status).toBe(
    200,
  )
  expect(mock.sent()).toMatchObject([{ bot: 'feedway_mock_bot', chatId: 42, text: 'Ciao' }])
  mock.block(42)
  expect(await call(platform.token, 'sendMessage', { chat_id: 42, text: 'Ciao' })).toMatchObject({
    status: 403,
    body: { description: 'Forbidden: bot was blocked by the user' },
  })
})

test('429 with retry_after and 502, for the given number of calls', async () => {
  mock.rateLimit({ retryAfter: 3, method: 'sendMessage' })
  expect(await call(platform.token, 'sendMessage', { chat_id: 1, text: 'x' })).toMatchObject({
    status: 429,
    body: { parameters: { retry_after: 3 } },
  })
  expect((await call(platform.token, 'sendMessage', { chat_id: 1, text: 'x' })).status).toBe(200)
  mock.unavailable({ times: 2 })
  expect((await call(platform.token, 'getMe')).status).toBe(502)
  expect((await call(platform.token, 'getMe')).status).toBe(502)
  expect((await call(platform.token, 'getMe')).status).toBe(200)
})

test('calls name the bot, never the token', async () => {
  await call(platform.token, 'getMe')
  expect(JSON.stringify(mock.calls())).not.toContain(platform.token)
})

test('parse_mode HTML: what Telegram shows, or null where it refuses the text', () => {
  expect(visibleText('<b>Ciao</b> &amp; <a href="https://x.it/?a=1&amp;b=2">qui</a>')).toBe(
    'Ciao & qui',
  )
  for (const bad of ['a < b', 'a > b', 'a & b', '<b>x', '<b><i>x</b></i>', '<div>x</div>'])
    expect(visibleText(bad)).toBeNull()
})
