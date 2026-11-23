import { expect, test } from 'vitest'
import { inQuietHours } from './quiet-hours.js'

const ROME = 'Europe/Rome'
const night = { start: '22:00', end: '07:00' }

test('quiet hours across midnight hold at 23:30 and at 06:59, not at 07:00', () => {
  // 2026-11-23 is winter time in Rome: UTC+1
  expect(inQuietHours(night, new Date('2026-11-23T22:30:00Z'), ROME)).toBe(true)
  expect(inQuietHours(night, new Date('2026-11-24T05:59:00Z'), ROME)).toBe(true)
  expect(inQuietHours(night, new Date('2026-11-24T06:00:00Z'), ROME)).toBe(false)
  expect(inQuietHours(night, new Date('2026-11-23T20:59:00Z'), ROME)).toBe(false)
})

test('quiet hours within a day start at their start and end before their end', () => {
  const lunch = { start: '13:00', end: '14:00' }
  expect(inQuietHours(lunch, new Date('2026-11-23T12:00:00Z'), ROME)).toBe(true)
  expect(inQuietHours(lunch, new Date('2026-11-23T13:00:00Z'), ROME)).toBe(false)
})

test('quiet hours are off when not set, or when they start where they end', () => {
  expect(inQuietHours(null, new Date('2026-11-23T22:30:00Z'), ROME)).toBe(false)
  const empty = { start: '22:00', end: '22:00' }
  expect(inQuietHours(empty, new Date('2026-11-23T21:00:00Z'), ROME)).toBe(false)
})
