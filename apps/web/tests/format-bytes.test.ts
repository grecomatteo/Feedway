import { expect, test } from 'vitest'
import { formatBytes, formatDuration } from '../app/utils/format-bytes.ts'

test('sizes use decimal units, one decimal from MB up', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(999)).toBe('999 B')
  expect(formatBytes(1500)).toBe('2 kB')
  expect(formatBytes(8_000_000)).toBe('8 MB')
  expect(formatBytes(1_250_000)).toBe('1,3 MB')
  expect(formatBytes(2_500_000_000)).toBe('2,5 GB')
})

test('a duration reads m:ss, or h:mm:ss past the hour', () => {
  expect(formatDuration(18_000)).toBe('0:18')
  expect(formatDuration(61_400)).toBe('1:01')
  expect(formatDuration(3_725_000)).toBe('1:02:05')
})
