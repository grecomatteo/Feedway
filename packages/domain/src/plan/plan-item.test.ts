import { describe, expect, test } from 'vitest'
import { DomainError } from '../errors.js'
import {
  dueNotificationAt,
  planItemState,
  planNote,
  planTitle,
  plannedVsPost,
  referenceInstant,
} from './plan-item.js'

const ROME = 'Europe/Rome'
const HOUR = 3_600_000
const SECOND = 1000

describe('the reference instant', () => {
  test('a day and a time of Rome', () => {
    expect(referenceInstant('2026-12-20', '18:00', ROME)).toEqual(new Date('2026-12-20T17:00:00Z'))
  })

  test('without a time, the end of the day', () => {
    expect(referenceInstant('2026-12-20', null, ROME)).toEqual(new Date('2026-12-20T22:59:00Z'))
  })

  test('02:30 of the two changes of the clocks (§9.2)', () => {
    // happens twice on 25/10/2026: the first; missing on 28/03/2027: an hour on
    expect(referenceInstant('2026-10-25', '02:30', ROME)).toEqual(new Date('2026-10-25T00:30:00Z'))
    expect(referenceInstant('2027-03-28', '02:30', ROME)).toEqual(new Date('2027-03-28T01:30:00Z'))
    // the end of the day of 25 hours is still in winter time
    expect(referenceInstant('2026-10-25', null, ROME)).toEqual(new Date('2026-10-25T22:59:00Z'))
  })
})

describe('the state', () => {
  const item = { localDate: '2026-12-20', localTime: '18:00' }
  const reference = new Date('2026-12-20T17:00:00Z').getTime()
  const at = (ms: number) => new Date(ms)

  test('to prepare, due soon from 36 hours before, late a second after', () => {
    expect(planItemState(item, null, at(reference - 36 * HOUR - SECOND), ROME)).toBe('to_prepare')
    expect(planItemState(item, null, at(reference - 36 * HOUR), ROME)).toBe('due_soon')
    expect(planItemState(item, null, at(reference), ROME)).toBe('due_soon')
    expect(planItemState(item, null, at(reference + SECOND), ROME)).toBe('late')
  })

  test('prepared while its post stands; a cancelled post gives it back (rule 5)', () => {
    const late = at(reference + HOUR)
    expect(planItemState(item, { status: 'draft', scheduledAt: null }, late, ROME)).toBe('prepared')
    expect(planItemState(item, { status: 'published', scheduledAt: null }, late, ROME)).toBe(
      'prepared',
    )
    expect(planItemState(item, { status: 'cancelled', scheduledAt: null }, late, ROME)).toBe('late')
  })

  test('without a time: late only after 23:59', () => {
    const day = { localDate: '2026-12-20', localTime: null }
    expect(planItemState(day, null, new Date('2026-12-20T22:59:00Z'), ROME)).toBe('due_soon')
    expect(planItemState(day, null, new Date('2026-12-20T22:59:01Z'), ROME)).toBe('late')
  })

  test('at 02:30 of the change of the clocks', () => {
    const spring = { localDate: '2027-03-28', localTime: '02:30' }
    expect(planItemState(spring, null, new Date('2027-03-28T01:30:00Z'), ROME)).toBe('due_soon')
    expect(planItemState(spring, null, new Date('2027-03-28T01:30:01Z'), ROME)).toBe('late')
    const autumn = { localDate: '2026-10-25', localTime: '02:30' }
    expect(planItemState(autumn, null, new Date('2026-10-25T00:30:01Z'), ROME)).toBe('late')
  })
})

describe('the notification', () => {
  test('24 hours before a content with a time', () => {
    expect(dueNotificationAt({ localDate: '2026-12-20', localTime: '10:00' }, ROME)).toEqual(
      new Date('2026-12-19T09:00:00Z'),
    )
  })

  test('at 9:00 of the day before without a time, also across the change of the clocks', () => {
    expect(dueNotificationAt({ localDate: '2026-12-20', localTime: null }, ROME)).toEqual(
      new Date('2026-12-19T08:00:00Z'),
    )
    // 26/10: the day before is the day of 25 hours, already in winter time at 9:00
    expect(dueNotificationAt({ localDate: '2026-10-26', localTime: null }, ROME)).toEqual(
      new Date('2026-10-25T08:00:00Z'),
    )
    expect(dueNotificationAt({ localDate: '2027-03-01', localTime: null }, ROME)).toEqual(
      new Date('2027-02-28T08:00:00Z'),
    )
  })

  test('an impossible day is refused, never moved to the next one', () => {
    expect(() => dueNotificationAt({ localDate: '2026-02-30', localTime: null }, ROME)).toThrow(
      DomainError,
    )
  })
})

test('«Previsto dal piano il 20» only when the post goes out on another day of Rome', () => {
  const item = { localDate: '2026-12-20' }
  expect(plannedVsPost(item, { scheduledAt: new Date('2026-12-20T23:00:00Z') }, ROME)).toEqual({
    plannedDate: '2026-12-20',
  })
  expect(plannedVsPost(item, { scheduledAt: new Date('2026-12-20T22:59:00Z') }, ROME)).toBeNull()
  expect(plannedVsPost(item, { scheduledAt: null }, ROME)).toBeNull()
})

test('title and note as stored', () => {
  expect(planTitle('  Reel   del pane ')).toBe('Reel del pane')
  expect(planTitle('')).toBeNull()
  expect(planTitle('x'.repeat(81))).toBeNull()
  expect(planTitle('x'.repeat(80))).toBe('x'.repeat(80))
  expect(planNote(' Usa la foto del forno\r\ncon la luce ')).toBe(
    'Usa la foto del forno\ncon la luce',
  )
  expect(planNote('')).toBe('')
  expect(planNote('a‮b')).toBeNull()
  expect(planNote('x'.repeat(2001))).toBeNull()
})
