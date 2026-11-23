import { TelegramApiError } from '@app/application'
import { TELEGRAM_MOCK, startTelegramMock } from '@app/telegram-mock'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { createTelegramBotApi } from './telegram-bot-api.js'

const mock = await startTelegramMock()
afterAll(() => mock.stop())
beforeEach(() => {
  mock.reset()
})

const api = createTelegramBotApi({ baseUrl: new URL(mock.url), timeoutMs: 2000 })
const { token } = TELEGRAM_MOCK.bots.platform

async function failure(promise: Promise<unknown>): Promise<TelegramApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  if (!(error instanceof TelegramApiError))
    throw new Error(`not a TelegramApiError: ${String(error)}`)
  return error
}

test('getMe gives the bot id and username', async () => {
  expect(await api.getMe(token)).toEqual({ id: 1000000001, username: 'feedway_mock_bot' })
})

test('a wrong or revoked token is unauthorized, and the error never holds it', async () => {
  const wrong = await failure(api.getMe('123:wrong-token-value'))
  expect(wrong.kind).toBe('unauthorized')
  expect(wrong.message).not.toContain('wrong-token-value')
  mock.revoke(token)
  const revoked = await failure(api.getMe(token))
  expect(revoked.kind).toBe('unauthorized')
  expect(`${revoked.message} ${String(revoked.stack)}`).not.toContain(token)
})

test('getUpdates reads the private texts and the offset confirms them', async () => {
  mock.userWrites(token, { chatId: 42, text: '/start abc' })
  const updates = await api.getUpdates(token, { offset: 0, timeoutSeconds: 0 })
  expect(updates.map((u) => u.message)).toEqual([{ chatId: 42, text: '/start abc' }])
  const next = (updates[0]?.updateId ?? 0) + 1
  expect(await api.getUpdates(token, { offset: next, timeoutSeconds: 0 })).toEqual([])
})

test('sendMessage sends plain text without link previews', async () => {
  await api.sendMessage(token, { chatId: 42, text: 'Ciao' })
  const [sent] = mock.sent()
  expect(sent).toMatchObject({ chatId: 42, text: 'Ciao' })
  expect(sent?.params).toMatchObject({ link_preview_options: { is_disabled: true } })
  expect(sent?.params).not.toHaveProperty('parse_mode')
})

test('403 is blocked, 429 carries retry_after, 502 is unavailable', async () => {
  mock.block(42)
  expect((await failure(api.sendMessage(token, { chatId: 42, text: 'x' }))).kind).toBe('blocked')
  mock.rateLimit({ retryAfter: 7 })
  const limited = await failure(api.sendMessage(token, { chatId: 1, text: 'x' }))
  expect([limited.kind, limited.retryAfterSeconds]).toEqual(['rate_limited', 7])
  mock.unavailable()
  expect((await failure(api.getMe(token))).kind).toBe('unavailable')
  expect((await failure(api.sendMessage(token, { chatId: 1, text: ' ' }))).kind).toBe('bad_request')
})

test('no answer in time, or nobody listening, is unavailable', async () => {
  // a server that takes the connection and never answers
  const silent = createServer(() => undefined)
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
  const { port } = silent.address() as AddressInfo
  const slow = createTelegramBotApi({
    baseUrl: new URL(`http://127.0.0.1:${String(port)}`),
    timeoutMs: 100,
  })
  const started = Date.now()
  expect((await failure(slow.getMe(token))).kind).toBe('unavailable')
  expect(Date.now() - started).toBeLessThan(1500)
  silent.closeAllConnections()
  silent.close()
  const nobody = createTelegramBotApi({ baseUrl: new URL('http://127.0.0.1:9'), timeoutMs: 500 })
  expect((await failure(nobody.getMe(token))).kind).toBe('unavailable')
})

test('an abort from the caller stops the long poll', async () => {
  const controller = new AbortController()
  setTimeout(() => {
    controller.abort()
  }, 50)
  const started = Date.now()
  expect(
    (await failure(api.getUpdates(token, { offset: 0, timeoutSeconds: 5 }, controller.signal)))
      .kind,
  ).toBe('unavailable')
  expect(Date.now() - started).toBeLessThan(1500)
})

test('the token goes in the path as @BotFather gives it, colon and all', async () => {
  let seen = ''
  const echo = createServer((req, res) => {
    seen = req.url ?? ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, result: { id: 1000000001, username: 'feedway_mock_bot' } }))
  })
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve))
  const { port } = echo.address() as AddressInfo
  const raw = createTelegramBotApi({ baseUrl: new URL(`http://127.0.0.1:${String(port)}`) })
  await raw.getMe(token)
  echo.close()
  expect(seen).toBe(`/bot${token}/getMe`)
})
