import { expect, test } from 'vitest'
import { secondsDown, secondsUp } from './seconds.js'

test('a value under a minimum never reads as the minimum (P3)', () => {
  expect(secondsDown(2_960)).toBe(2.9)
  expect(secondsDown(2_999)).toBe(2.9)
  expect(secondsDown(3_000)).toBe(3)
})

test('a value over a maximum never reads as the maximum (P3)', () => {
  expect(secondsUp(90_040)).toBe(90.1)
  expect(secondsUp(60_001)).toBe(60.1)
  expect(secondsUp(90_000)).toBe(90)
})
