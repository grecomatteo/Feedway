import { expect, test } from 'vitest'
import { loginDelayMs } from './login-throttle.js'

test.each([
  [0, 0],
  [4, 0],
  [5, 30_000],
  [6, 60_000],
  [8, 240_000],
  [9, 480_000],
  [10, 900_000],
  [20, 900_000],
])('%i failures → %i ms', (n, ms) => {
  expect(loginDelayMs(n)).toBe(ms)
})

test('a broken counter fails closed', () => {
  expect(loginDelayMs(Number.NaN)).toBe(900_000)
  expect(loginDelayMs(Number.POSITIVE_INFINITY)).toBe(900_000)
})
