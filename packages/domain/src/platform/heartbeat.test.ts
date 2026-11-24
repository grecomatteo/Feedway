import { expect, test } from 'vitest'
import {
  HEARTBEAT_RETIRED_MS,
  WORKER_BEAT_EVERY_MS,
  beatHealth,
  externalWatchUrlProblem,
  workerSilent,
} from './heartbeat.js'

const now = new Date('2026-11-23T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

test('a beat is fresh up to a minute, late up to two, then the worker is silent (§16.7)', () => {
  expect(beatHealth(ago(WORKER_BEAT_EVERY_MS), now)).toBe('ok')
  expect(beatHealth(ago(60_000), now)).toBe('ok')
  expect(beatHealth(ago(60_001), now)).toBe('late')
  expect(beatHealth(ago(120_000), now)).toBe('late')
  expect(beatHealth(ago(120_001), now)).toBe('silent')
})

test('a beat from a clock a little ahead counts as fresh', () => {
  expect(beatHealth(new Date(now.getTime() + 5_000), now)).toBe('ok')
})

test('the worker is silent only when no instance beat in the last two minutes', () => {
  expect(workerSilent([], now)).toBe(true)
  expect(workerSilent([ago(3 * 60_000)], now)).toBe(true)
  expect(workerSilent([ago(3 * 60_000), ago(10_000)], now)).toBe(false)
})

test('an instance is retired after seven days without a beat', () => {
  expect(HEARTBEAT_RETIRED_MS).toBe(7 * 24 * 3600_000)
})

test('the external watch address is https, without credentials or spaces', () => {
  expect(externalWatchUrlProblem('https://hc-ping.com/1b2c3d4e-0000-4000-8000-000000000000')).toBe(
    null,
  )
  expect(externalWatchUrlProblem('https://kuma.example.org/api/push/abc?status=up')).toBe(null)
  expect(externalWatchUrlProblem('http://hc-ping.com/abc')).toBe('not_https')
  expect(externalWatchUrlProblem('https://user:pw@hc-ping.com/abc')).toBe('credentials')
  expect(externalWatchUrlProblem('non è un indirizzo')).toBe('invalid')
  expect(externalWatchUrlProblem(`https://hc-ping.com/${'a'.repeat(600)}`)).toBe('invalid')
})
