import { expect, test } from 'vitest'
import { atLeast } from './levels.js'

test('levels go from info to security, and each is at least itself', () => {
  expect(atLeast('error', 'warning')).toBe(true)
  expect(atLeast('error', 'error')).toBe(true)
  expect(atLeast('success', 'warning')).toBe(false)
  expect(atLeast('security', 'critical')).toBe(true)
  expect(atLeast('info', 'success')).toBe(false)
})
