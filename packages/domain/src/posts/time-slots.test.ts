import { describe, expect, test } from 'vitest'
import {
  TIME_SLOTS_MAX,
  distributeOnSlots,
  nextFreeSlot,
  validateTimeSlots,
  type TimeSlot,
} from './time-slots.js'

// The client's usual times and the next free one (spec §11.6, plan 09 Task 9).
const ROME = 'Europe/Rome'
const at = (iso: string) => new Date(iso)
const local = (s: { localDate: string; localTime: string } | null | undefined) =>
  s ? `${s.localDate} ${s.localTime}` : null

// Monday to Friday at 12:30 and 18:00
const WEEKDAYS: TimeSlot[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday: weekday as TimeSlot['weekday'], localTime: '12:30' },
  { weekday: weekday as TimeSlot['weekday'], localTime: '18:00' },
])

describe('validateTimeSlots', () => {
  test('in order of the week and the time, a repeat once', () => {
    const r = validateTimeSlots([
      { weekday: 3, localTime: '18:00' },
      { weekday: 1, localTime: '18:00' },
      { weekday: 1, localTime: '09:15' },
      { weekday: 3, localTime: '18:00' },
    ])
    expect(r).toEqual({
      ok: true,
      value: [
        { weekday: 1, localTime: '09:15' },
        { weekday: 1, localTime: '18:00' },
        { weekday: 3, localTime: '18:00' },
      ],
    })
  })

  test('a day outside 1–7 or a time that is not HH:MM is refused, with its row', () => {
    for (const bad of [
      { weekday: 0, localTime: '12:00' },
      { weekday: 8, localTime: '12:00' },
      { weekday: 1.5, localTime: '12:00' },
      { weekday: 1, localTime: '24:00' },
      { weekday: 1, localTime: '9:00' },
      { weekday: 1, localTime: '12:00:00' },
      { weekday: '1', localTime: '12:00' },
    ])
      expect(validateTimeSlots([{ weekday: 2, localTime: '10:00' }, bad])).toEqual({
        ok: false,
        reason: 'invalid',
        index: 1,
      })
  })

  test(`at most ${String(TIME_SLOTS_MAX)}`, () => {
    const many = Array.from({ length: TIME_SLOTS_MAX + 1 }, (_, i) => ({
      weekday: (i % 7) + 1,
      localTime: `${String(Math.floor(i / 7)).padStart(2, '0')}:00`,
    }))
    expect(validateTimeSlots(many.slice(0, TIME_SLOTS_MAX)).ok).toBe(true)
    expect(validateTimeSlots(many)).toEqual({ ok: false, reason: 'too_many' })
  })
})

describe('nextFreeSlot', () => {
  // Tuesday 24 November 2026, 10:00 in Rome
  const tuesdayMorning = at('2026-11-24T09:00:00Z')

  test('the first slot ahead, in the agency’s zone', () => {
    const s = nextFreeSlot(WEEKDAYS, [], tuesdayMorning, ROME)
    expect(local(s)).toBe('2026-11-24 12:30')
    expect(s?.instant.toISOString()).toBe('2026-11-24T11:30:00.000Z')
  })

  test('a slot with a scheduled post at that minute is skipped', () => {
    const s = nextFreeSlot(WEEKDAYS, [at('2026-11-24T11:30:00Z')], tuesdayMorning, ROME)
    expect(local(s)).toBe('2026-11-24 18:00')
  })

  test('a post at another minute does not take the slot', () => {
    const s = nextFreeSlot(WEEKDAYS, [at('2026-11-24T11:31:00Z')], tuesdayMorning, ROME)
    expect(local(s)).toBe('2026-11-24 12:30')
  })

  test('the slot of the minute in progress is past', () => {
    expect(local(nextFreeSlot(WEEKDAYS, [], at('2026-11-24T11:30:20Z'), ROME))).toBe(
      '2026-11-24 18:00',
    )
  })

  test('no slots: none', () => {
    expect(nextFreeSlot([], [], tuesdayMorning, ROME)).toBeNull()
  })

  test('the week starts again: Friday evening gives Monday', () => {
    // Friday 27 November, 19:00
    const s = nextFreeSlot(WEEKDAYS, [], at('2026-11-27T18:00:00Z'), ROME)
    expect(local(s)).toBe('2026-11-30 12:30')
  })

  test('a Sunday slot, from Monday, is six days on', () => {
    const sunday: TimeSlot[] = [{ weekday: 7, localTime: '10:00' }]
    expect(local(nextFreeSlot(sunday, [], at('2026-11-30T12:00:00Z'), ROME))).toBe(
      '2026-12-06 10:00',
    )
  })

  test('every slot taken for three months: none', () => {
    const monday: TimeSlot[] = [{ weekday: 1, localTime: '12:00' }]
    const taken = Array.from(
      { length: 14 },
      (_, i) => new Date(Date.parse('2026-11-30T11:00:00Z') + i * 7 * 86_400_000),
    )
    expect(nextFreeSlot(monday, taken, tuesdayMorning, ROME)).toBeNull()
  })

  test('02:30 of the day the clocks go back (25/10/2026) is the first one', () => {
    const sunday: TimeSlot[] = [{ weekday: 7, localTime: '02:30' }]
    const s = nextFreeSlot(sunday, [], at('2026-10-24T12:00:00Z'), ROME)
    expect(local(s)).toBe('2026-10-25 02:30')
    expect(s?.instant.toISOString()).toBe('2026-10-25T00:30:00.000Z')
  })

  test('02:30 of the day the clocks go forward (28/03/2027) is 03:30', () => {
    const sunday: TimeSlot[] = [{ weekday: 7, localTime: '02:30' }]
    const s = nextFreeSlot(sunday, [], at('2027-03-27T12:00:00Z'), ROME)
    expect(local(s)).toBe('2027-03-28 03:30')
    expect(s?.instant.toISOString()).toBe('2027-03-28T01:30:00.000Z')
  })

  test('02:30 and 03:30 of the day the clocks go forward are one slot', () => {
    const sunday: TimeSlot[] = [
      { weekday: 7, localTime: '02:30' },
      { weekday: 7, localTime: '03:30' },
    ]
    const s = nextFreeSlot(sunday, [at('2027-03-28T01:30:00Z')], at('2027-03-27T12:00:00Z'), ROME)
    expect(local(s)).toBe('2027-04-04 02:30')
  })

  test('the day the clocks go forward, 03:15 comes before 02:30 moved to 03:30', () => {
    const sunday: TimeSlot[] = [
      { weekday: 7, localTime: '02:30' },
      { weekday: 7, localTime: '03:15' },
    ]
    const after = at('2027-03-27T23:00:00Z')
    expect(local(nextFreeSlot(sunday, [], after, ROME))).toBe('2027-03-28 03:15')
    expect(
      distributeOnSlots(sunday, [], 2, after, ROME).map((s) => s.instant.toISOString()),
    ).toEqual(['2027-03-28T01:15:00.000Z', '2027-03-28T01:30:00.000Z'])
  })
})

describe('distributeOnSlots', () => {
  test('one post per free slot, in order', () => {
    const got = distributeOnSlots(
      WEEKDAYS,
      [at('2026-11-24T17:00:00Z')],
      4,
      at('2026-11-24T09:00:00Z'),
      ROME,
    )
    expect(got.map(local)).toEqual([
      '2026-11-24 12:30',
      '2026-11-25 12:30',
      '2026-11-25 18:00',
      '2026-11-26 12:30',
    ])
  })

  test('across the change of the clocks, each slot at its local time', () => {
    const sunday: TimeSlot[] = [{ weekday: 7, localTime: '18:00' }]
    const got = distributeOnSlots(sunday, [], 3, at('2026-10-17T12:00:00Z'), ROME)
    expect(got.map(local)).toEqual(['2026-10-18 18:00', '2026-10-25 18:00', '2026-11-01 18:00'])
    expect(got.map((s) => s.instant.toISOString())).toEqual([
      '2026-10-18T16:00:00.000Z',
      '2026-10-25T17:00:00.000Z',
      '2026-11-01T17:00:00.000Z',
    ])
  })

  test('no slots or nothing to place: none', () => {
    expect(distributeOnSlots([], [], 3, at('2026-11-24T09:00:00Z'), ROME)).toEqual([])
    expect(distributeOnSlots(WEEKDAYS, [], 0, at('2026-11-24T09:00:00Z'), ROME)).toEqual([])
  })
})
