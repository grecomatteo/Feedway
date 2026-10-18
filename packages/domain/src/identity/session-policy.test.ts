import { expect, test } from 'vitest'
import {
  hasRecentReauth,
  isBeyondAbsoluteLifetime,
  REAUTH_WINDOW_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from './session-policy.js'

const now = new Date('2026-10-18T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)

test('durations', () => {
  expect(SESSION_IDLE_MS).toBe(12 * 3600_000)
  expect(SESSION_ABSOLUTE_MS).toBe(30 * 86_400_000)
  expect(REAUTH_WINDOW_MS).toBe(10 * 60_000)
})
test('absolute lifetime is 30 days from creation', () => {
  expect(isBeyondAbsoluteLifetime(daysAgo(29.9), now)).toBe(false)
  expect(isBeyondAbsoluteLifetime(daysAgo(30.1), now)).toBe(true)
})
test('reauth expires after 10 minutes', () => {
  expect(hasRecentReauth(minutesAgo(9), now)).toBe(true)
  expect(hasRecentReauth(minutesAgo(11), now)).toBe(false)
  expect(hasRecentReauth(null, now)).toBe(false)
})
test('boundaries fall on the safe side', () => {
  expect(isBeyondAbsoluteLifetime(daysAgo(30), now)).toBe(true)
  expect(hasRecentReauth(minutesAgo(10), now)).toBe(false)
})
