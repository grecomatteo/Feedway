import { expect, test } from 'vitest'
import { DEFAULT_DIGEST, digestTimeZone, nextDigestAt } from './digest-schedule.js'

const ROME = 'Europe/Rome'

test('the digest is at 8:00 in Rome on the day the clocks go back', () => {
  // 2026-10-25: at 03:00 summer time the clocks go back to 02:00, and Rome is UTC+1; from 01:00
  // summer time, the offset of that moment would give 06:00Z
  expect(nextDigestAt(DEFAULT_DIGEST, new Date('2026-10-24T23:00:00Z'), ROME)).toEqual(
    new Date('2026-10-25T07:00:00Z'),
  )
})

test('the digest is at 8:00 in Rome on the day the clocks go forward', () => {
  // 2027-03-28: from 02:00 Rome is UTC+2
  expect(nextDigestAt(DEFAULT_DIGEST, new Date('2027-03-28T00:30:00Z'), ROME)).toEqual(
    new Date('2027-03-28T06:00:00Z'),
  )
})

test('once 8:00 has passed, the next digest is tomorrow; at 8:00 it is now', () => {
  const at8 = new Date('2026-11-23T07:00:00Z')
  expect(nextDigestAt(DEFAULT_DIGEST, at8, ROME)).toEqual(at8)
  expect(nextDigestAt(DEFAULT_DIGEST, new Date('2026-11-23T07:00:01Z'), ROME)).toEqual(
    new Date('2026-11-24T07:00:00Z'),
  )
})

test('the digest keeps to the days and time the person chose', () => {
  // Monday 2026-11-23, after 9:30: next Monday is a week later
  const mondays = { enabled: true, time: '09:30', days: [1] } as const
  expect(nextDigestAt(mondays, new Date('2026-11-23T09:00:00Z'), ROME)).toEqual(
    new Date('2026-11-30T08:30:00Z'),
  )
})

test('a digest turned off, or with no day, never comes', () => {
  const now = new Date('2026-11-23T05:00:00Z')
  expect(nextDigestAt({ ...DEFAULT_DIGEST, enabled: false }, now, ROME)).toBeNull()
  expect(nextDigestAt({ ...DEFAULT_DIGEST, days: [] }, now, ROME)).toBeNull()
})

test("the person's zone comes first, then their first agency's, then the default", () => {
  expect(digestTimeZone('Europe/London', ['Europe/Rome'], 'UTC')).toBe('Europe/London')
  expect(digestTimeZone(null, ['America/New_York', 'Europe/Rome'], 'UTC')).toBe('America/New_York')
  expect(digestTimeZone(null, [], 'Europe/Rome')).toBe('Europe/Rome')
})
