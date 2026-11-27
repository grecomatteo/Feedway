import { expect, test, vi } from 'vitest'
import type { IntegrationStore, TelegramBotCredentials } from '../ports/integration-store.js'
import type { Logger } from '../ports/logger.js'
import { TelegramApiError, type TelegramBotApi } from '../ports/telegram-bot-api.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { createTelegramPollHealth, type TelegramPollHealth } from './telegram-poll-health.js'
import { TELEGRAM_MENU_VERSION, pollTelegram, type TelegramPollDeps } from './telegram-poll.js'

// How `telegram.poll` logs and tries again when the long poll fails (D-134); what it answers is
// in the integration tests of the infrastructure, against the database and the mock.

type Answer = 'empty' | TelegramApiError

function setUp(answers: Answer[], options: { waitSeconds?: number; health?: TelegramPollHealth }) {
  let time = Date.UTC(2026, 10, 27, 12, 0, 0)
  const logs: { level: string; msg: string; obj: Record<string, unknown> }[] = []
  const record =
    (level: string) =>
    (obj: object, msg = '') => {
      logs.push({ level, msg, obj: obj as Record<string, unknown> })
    }
  const logger: Logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  }
  const bot: TelegramBotCredentials = {
    organizationId: null,
    botId: 1,
    botUsername: 'feedway_bot',
    token: 'secret',
    state: { botId: 1, offset: 0, commands: TELEGRAM_MENU_VERSION },
    rejectedAt: null,
    updatedAt: new Date(0),
  }
  const markPlatformRejected = vi.fn(() => Promise.resolve(true))
  const tx = {
    telegramLinks: { deleteOrphans: () => Promise.resolve(0) },
    integrations: { saveState: () => Promise.resolve(true), markPlatformRejected },
  }
  const getUpdates = vi.fn((_token: string, { timeoutSeconds }: { timeoutSeconds: number }) => {
    const next = answers.shift() ?? 'empty'
    if (next === 'empty') {
      time += timeoutSeconds * 1000
      return Promise.resolve([])
    }
    return Promise.reject(next)
  })
  const sleep = vi.fn((ms: number) => {
    time += ms
    return Promise.resolve()
  })
  const deps: TelegramPollDeps = {
    uow: {
      runAsSystem: (_reason: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as UnitOfWork,
    clock: { now: () => new Date(time) },
    logger,
    t: (key) => key,
    panelUrl: new URL('https://pannello.example/'),
    integrations: {
      telegramBots: () => Promise.resolve({ bots: [{ ...bot }], unreadable: [] }),
    } as unknown as IntegrationStore,
    telegram: { getUpdates } as unknown as TelegramBotApi,
    tokens: { hash: (v: string) => Buffer.from(v) },
    lock: { tryRun: async (_name, fn) => ({ acquired: true, value: await fn() }) },
    waitSeconds: options.waitSeconds ?? 0,
    health: options.health ?? createTelegramPollHealth(),
    sleep,
  }
  const pollLogs = () => logs.filter((l) => l.msg.startsWith('telegram'))
  return { deps, getUpdates, sleep, markPlatformRejected, pollLogs }
}

const down = () => new TelegramApiError('unavailable', 'getUpdates')

test('one failure of the long poll is info, and the run tries again after a second', async () => {
  const { deps, getUpdates, sleep, pollLogs } = setUp([down()], { waitSeconds: 30 })
  await pollTelegram(deps)
  expect(sleep).toHaveBeenCalledTimes(1)
  expect(sleep.mock.calls[0]?.[0]).toBe(1000)
  expect(getUpdates.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(pollLogs().map((l) => [l.level, l.msg])).toEqual([
    ['info', 'telegram poll failed'],
    ['debug', 'telegram poll back'],
  ])
  expect(pollLogs()[0]?.obj).toMatchObject({ bot: 'feedway_bot', kind: 'unavailable', failures: 1 })
})

test('failing many times in a row is one error, then its end at info', async () => {
  const { deps, sleep, pollLogs } = setUp(Array.from({ length: 12 }, down), { waitSeconds: 200 })
  await pollTelegram(deps)
  expect(sleep.mock.calls.map(([ms]) => ms / 1000)).toEqual([
    1, 2, 4, 8, 15, 15, 15, 15, 15, 15, 15, 15,
  ])
  const levels = pollLogs().map((l) => [l.level, l.msg])
  expect(levels.filter(([level]) => level === 'error')).toEqual([
    ['error', 'telegram poll failing'],
  ])
  expect(levels.filter(([level]) => level === 'warn')).toEqual([])
  expect(levels.at(-1)).toEqual(['info', 'telegram poll recovered'])
  expect(pollLogs().at(-1)?.obj).toMatchObject({ failures: 12 })
})

test('the count goes on from one run to the next', async () => {
  const health = createTelegramPollHealth({ alarmAfterFailures: 3 })
  for (let run = 1; run <= 2; run++) {
    const { deps } = setUp([down()], { health })
    await pollTelegram(deps)
  }
  const { deps, pollLogs } = setUp([down()], { health })
  await pollTelegram(deps)
  expect(pollLogs().map((l) => [l.level, l.msg])).toEqual([['error', 'telegram poll failing']])
})

test('without time left in the run, no wait: the next run tries again', async () => {
  const { deps, getUpdates, sleep } = setUp([down()], { waitSeconds: 0 })
  await pollTelegram(deps)
  expect(sleep).not.toHaveBeenCalled()
  expect(getUpdates).toHaveBeenCalledTimes(1)
})

test('a 429 waits as long as Telegram asks', async () => {
  const limited = new TelegramApiError('rate_limited', 'getUpdates', 7)
  const { deps, sleep, pollLogs } = setUp([limited], { waitSeconds: 30 })
  await pollTelegram(deps)
  expect(sleep.mock.calls[0]?.[0]).toBe(7000)
  expect(pollLogs()[0]).toMatchObject({ level: 'info', msg: 'telegram poll failed' })
})

test('a token refused is an error at once, with no try again', async () => {
  const refused = new TelegramApiError('unauthorized', 'getUpdates')
  const { deps, getUpdates, sleep, markPlatformRejected, pollLogs } = setUp([refused], {
    waitSeconds: 30,
  })
  await pollTelegram(deps)
  expect(markPlatformRejected).toHaveBeenCalledTimes(1)
  expect(getUpdates).toHaveBeenCalledTimes(1)
  expect(sleep).not.toHaveBeenCalled()
  expect(pollLogs().map((l) => [l.level, l.msg])).toEqual([['error', 'telegram bot token refused']])
})

test('another poller on the same bot (409) is an error at once, then quiet until a reminder', async () => {
  const health = createTelegramPollHealth()
  const conflict = () => new TelegramApiError('conflict', 'getUpdates')
  const first = setUp([conflict()], { waitSeconds: 30, health })
  await pollTelegram(first.deps)
  expect(first.getUpdates).toHaveBeenCalledTimes(1)
  expect(first.sleep).not.toHaveBeenCalled()
  expect(first.pollLogs().map((l) => [l.level, l.msg])).toEqual([
    ['error', 'telegram poll refused'],
  ])
  const second = setUp([conflict()], { health })
  await pollTelegram(second.deps)
  expect(second.pollLogs().map((l) => l.level)).toEqual(['debug'])
})
