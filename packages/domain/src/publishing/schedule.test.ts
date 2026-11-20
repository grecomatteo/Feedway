import { describe, expect, it } from 'vitest'
import { instantToZoned, zonedToInstant } from '../time/index.js'
import { isTooLate, nextAttemptAt, prepareAt, recheckAt, verifyAt } from './schedule.js'

const MIN = 60_000
const at = (iso: string) => new Date(iso)
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN)
const rome = (instant: Date) => {
  const z = instantToZoned(instant, 'Europe/Rome')
  return `${z.localDate} ${z.localTime} ${z.offset}`
}

describe('nextAttemptAt (§9.5: 1, 5, 15 minutes after the failed step)', () => {
  const failedAt = at('2026-11-20T17:00:00Z')
  it('three new attempts, then none', () => {
    expect(nextAttemptAt(failedAt, 1)).toEqual(plus(failedAt, 1))
    expect(nextAttemptAt(failedAt, 2)).toEqual(plus(failedAt, 5))
    expect(nextAttemptAt(failedAt, 3)).toEqual(plus(failedAt, 15))
    expect(nextAttemptAt(failedAt, 4)).toBeNull()
  })
  it('refuses an attempt that is not a positive whole number', () => {
    expect(() => nextAttemptAt(failedAt, 0)).toThrow()
    expect(() => nextAttemptAt(failedAt, 1.5)).toThrow()
  })
  it('counts real minutes across the change of time (2026-10-25)', () => {
    // 02:55 CEST, five minutes before the clocks go back to 02:00
    const failed = zonedToInstant('2026-10-25', '02:55', 'Europe/Rome').instant
    const next = nextAttemptAt(failed, 3)
    expect(next).toEqual(plus(failed, 15))
    expect(rome(failed)).toBe('2026-10-25 02:55 +02:00')
    expect(rome(next as Date)).toBe('2026-10-25 02:10 +01:00')
  })
})

describe('verifyAt (§9.6: 3, 10, 30 minutes after publishing)', () => {
  const publishedAt = at('2026-11-20T17:00:00Z')
  it('three rounds, then none', () => {
    expect(verifyAt(publishedAt, 1)).toEqual(plus(publishedAt, 3))
    expect(verifyAt(publishedAt, 2)).toEqual(plus(publishedAt, 10))
    expect(verifyAt(publishedAt, 3)).toEqual(plus(publishedAt, 30))
    expect(verifyAt(publishedAt, 4)).toBeNull()
    expect(() => verifyAt(publishedAt, 0)).toThrow()
  })
  it('crosses the change of time with real minutes (2026-10-25 and 2027-03-28)', () => {
    const autumn = zonedToInstant('2026-10-25', '02:45', 'Europe/Rome').instant
    expect(rome(verifyAt(autumn, 3) as Date)).toBe('2026-10-25 02:15 +01:00')
    const spring = zonedToInstant('2027-03-28', '01:45', 'Europe/Rome').instant
    expect(rome(verifyAt(spring, 3) as Date)).toBe('2027-03-28 03:15 +02:00')
  })
})

describe('prepareAt (§9.4: 15 minutes before, at once when fewer are left)', () => {
  const now = at('2026-11-20T17:00:00Z')
  it('20 minutes before the post: 15 minutes before it', () => {
    expect(prepareAt(plus(now, 20), now)).toEqual(plus(now, 5))
  })
  it('15 minutes before the post: now', () => {
    expect(prepareAt(plus(now, 15), now)).toEqual(now)
  })
  it('3 minutes before the post, or after it: now', () => {
    expect(prepareAt(plus(now, 3), now)).toEqual(now)
    expect(prepareAt(plus(now, -30), now)).toEqual(now)
  })
  it('a post at 02:30 on 2027-03-28 (the time that does not exist) prepares at 01:45', () => {
    // D-49 (a): the skipped time is saved an hour later, 03:30 CEST
    const { instant } = zonedToInstant('2027-03-28', '02:30', 'Europe/Rome')
    expect(rome(instant)).toBe('2027-03-28 03:30 +02:00')
    expect(rome(prepareAt(instant, at('2027-03-27T12:00:00Z')))).toBe('2027-03-28 03:15 +02:00')
    // 15 real minutes before 03:05 CEST is 01:50 CET
    const early = zonedToInstant('2027-03-28', '03:05', 'Europe/Rome').instant
    expect(rome(prepareAt(early, at('2027-03-27T12:00:00Z')))).toBe('2027-03-28 01:50 +01:00')
  })
})

describe('isTooLate (D-77 b: 15 minutes, first start only)', () => {
  const scheduledAt = at('2026-11-20T12:00:00Z')
  it('in time up to the 15th minute, late from then on', () => {
    expect(isTooLate(scheduledAt, plus(scheduledAt, -1))).toBe(false)
    expect(isTooLate(scheduledAt, scheduledAt)).toBe(false)
    expect(isTooLate(scheduledAt, plus(scheduledAt, 15))).toBe(false)
    expect(isTooLate(scheduledAt, new Date(scheduledAt.getTime() + 15 * MIN + 1))).toBe(true)
    expect(isTooLate(scheduledAt, plus(scheduledAt, 16))).toBe(true)
  })
})

describe('recheckAt (Scelta 4: 3 hours before, at once when fewer are left)', () => {
  const now = at('2026-11-20T09:00:00Z')
  it('three hours before the post', () => {
    expect(recheckAt(plus(now, 5 * 60), now)).toEqual(plus(now, 2 * 60))
  })
  it('now when fewer than three hours are left', () => {
    expect(recheckAt(plus(now, 3 * 60), now)).toEqual(now)
    expect(recheckAt(plus(now, 60), now)).toEqual(now)
  })
  it('three real hours across the change of time (2026-10-25)', () => {
    const post = zonedToInstant('2026-10-25', '04:00', 'Europe/Rome').instant
    expect(rome(recheckAt(post, at('2026-10-24T12:00:00Z')))).toBe('2026-10-25 02:00 +02:00')
  })
})
