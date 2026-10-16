import { expect, test } from 'vitest'
import { fixedClock } from '../testing/index.js'

test('fixedClock stays put until advanced', () => {
  const clock = fixedClock(new Date('2026-01-01T00:00:00Z'))
  expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  clock.advance(1500)
  expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z')
})
