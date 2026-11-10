import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import type { Logger } from '@app/application'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { fixedClock } from '../../testing/index.js'
import { createMetaAppConnector } from './app-connector.js'
import { createMetaGraphClient } from './graph-client.js'

// verifyApp against the fake Graph API (plan 03, Task 4). Not verified on real Meta: that
// `debug_token` on the app token answers for the app is tried at the end of Task 7.

let mock: MetaMock
let connector: ReturnType<typeof createMetaAppConnector>

const quiet: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
}

beforeEach(async () => {
  mock = await startMetaMock()
  connector = createMetaAppConnector(
    createMetaGraphClient({
      mode: 'mock',
      version: 'v25.0',
      baseUrl: mock.url,
      clock: fixedClock(new Date('2026-11-09T12:00:00Z')),
      logger: quiet,
      timeoutMs: 200,
      retryBaseDelayMs: 1,
    }),
  )
})

afterEach(async () => {
  await mock.stop()
})

const app = { appId: META_MOCK.app.id, appSecret: META_MOCK.app.secret }

test('the right App ID and secret pass', async () => {
  expect(await connector.verifyApp(app)).toEqual({ ok: true })
})

test('a wrong secret, or the secret of another app, is rejected', async () => {
  expect(await connector.verifyApp({ ...app, appSecret: 'segreto-sbagliato' })).toEqual({
    ok: false,
    reason: 'rejected',
  })
  expect(await connector.verifyApp({ ...app, appId: '1000000000000999' })).toEqual({
    ok: false,
    reason: 'rejected',
  })
})

test('Meta down, slow or rate limited says nothing about the credentials', async () => {
  mock.scenario('html_5xx', { path: '/debug_token' })
  expect(await connector.verifyApp(app)).toEqual({ ok: false, reason: 'unavailable' })
  mock.scenario('default')
  mock.scenario('timeout', { path: '/debug_token', delayMs: 1000 })
  expect(await connector.verifyApp(app)).toEqual({ ok: false, reason: 'unavailable' })
  mock.scenario('default')
  mock.scenario('rate_limited', { path: '/debug_token', code: 4 })
  expect(await connector.verifyApp(app)).toEqual({ ok: false, reason: 'unavailable' })
})
