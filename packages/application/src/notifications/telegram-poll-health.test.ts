import { expect, test } from 'vitest'
import { createTelegramPollHealth, telegramRetrySeconds } from './telegram-poll-health.js'
import { TelegramApiError } from '../ports/telegram-bot-api.js'

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 27, 12, 0, seconds))

test('a failure now and then is only passing, and its end is quiet', () => {
  const health = createTelegramPollHealth()
  expect(health.failed('platform', at(0))).toEqual({ log: 'passing', failures: 1 })
  expect(health.succeeded('platform', at(5))).toEqual({
    failures: 1,
    failingSeconds: 5,
    alarmed: false,
  })
  // a success with no failure before has nothing to say
  expect(health.succeeded('platform', at(6))).toBeNull()
  expect(health.failed('platform', at(7))).toEqual({ log: 'passing', failures: 1 })
})

test('the alarm goes off once, after so many failures in a row, and its end is told', () => {
  const health = createTelegramPollHealth({ alarmAfterFailures: 3, alarmAfterSeconds: 600 })
  expect(health.failed('platform', at(0)).log).toBe('passing')
  expect(health.failed('platform', at(1)).log).toBe('passing')
  expect(health.failed('platform', at(2))).toEqual({
    log: 'alarm',
    failures: 3,
    failingSeconds: 2,
  })
  expect(health.failed('platform', at(3))).toEqual({ log: 'quiet', failures: 4, failingSeconds: 3 })
  expect(health.succeeded('platform', at(10))).toEqual({
    failures: 4,
    failingSeconds: 10,
    alarmed: true,
  })
  expect(health.failed('platform', at(11)).log).toBe('passing')
})

test('or after failing for so long, even with few failures', () => {
  const health = createTelegramPollHealth({ alarmAfterFailures: 10, alarmAfterSeconds: 300 })
  expect(health.failed('platform', at(0)).log).toBe('passing')
  expect(health.failed('platform', at(299)).log).toBe('passing')
  expect(health.failed('platform', at(300))).toEqual({
    log: 'alarm',
    failures: 3,
    failingSeconds: 300,
  })
})

test('a lasting failure is told again every so often, not at every try', () => {
  const health = createTelegramPollHealth({
    alarmAfterFailures: 2,
    alarmAfterSeconds: 600,
    remindAfterSeconds: 60,
  })
  health.failed('platform', at(0))
  expect(health.failed('platform', at(1)).log).toBe('alarm')
  expect(health.failed('platform', at(30)).log).toBe('quiet')
  expect(health.failed('platform', at(60)).log).toBe('quiet')
  expect(health.failed('platform', at(61)).log).toBe('alarm')
  expect(health.failed('platform', at(62)).log).toBe('quiet')
})

test('a failure that will not pass by itself raises the alarm at once', () => {
  const health = createTelegramPollHealth({ remindAfterSeconds: 60 })
  expect(health.failed('platform', at(0), { lasting: true })).toEqual({
    log: 'alarm',
    failures: 1,
    failingSeconds: 0,
  })
  expect(health.failed('platform', at(10), { lasting: true }).log).toBe('quiet')
  expect(health.failed('platform', at(61), { lasting: true }).log).toBe('alarm')
})

test('each bot is counted on its own', () => {
  const health = createTelegramPollHealth({ alarmAfterFailures: 2 })
  health.failed('platform', at(0))
  expect(health.failed('agency', at(1)).log).toBe('passing')
  expect(health.failed('platform', at(2)).log).toBe('alarm')
  expect(health.succeeded('agency', at(3))?.alarmed).toBe(false)
  expect(health.failed('platform', at(4)).log).toBe('quiet')
})

test('the wait before trying again doubles up to a ceiling, or is what Telegram asks', () => {
  const down = new TelegramApiError('unavailable', 'getUpdates')
  expect([1, 2, 3, 4, 5, 6, 9].map((n) => telegramRetrySeconds(n, down))).toEqual([
    1, 2, 4, 8, 15, 15, 15,
  ])
  const limited = new TelegramApiError('rate_limited', 'getUpdates', 7)
  expect(telegramRetrySeconds(1, limited)).toBe(7)
  // a 429 without its wait: as any other passing failure
  expect(telegramRetrySeconds(2, new TelegramApiError('rate_limited', 'getUpdates'))).toBe(2)
})
