import { describe, expect, test } from 'vitest'
import {
  formatDate,
  formatDay,
  formatRelative,
  formatShort,
  formatTime,
  formatWallSentence,
  formatWallShort,
} from '../app/utils/format-date.ts'

// The day of the design references: Thursday 19 November 2026, 10:00 in Rome.
const now = new Date('2026-11-19T09:00:00Z')
const rome = { timeZone: 'Europe/Rome', now }

describe('formatTime', () => {
  test('24-hour clock, no leading zero on the hour', () => {
    expect(formatTime('2026-11-20T07:00:00Z', rome)).toBe('8:00')
    expect(formatTime('2026-11-20T17:00:00Z', rome)).toBe('18:00')
    expect(formatTime('2026-11-19T23:00:00Z', rome)).toBe('0:00')
  })
  test('a wall time as the post keeps it', () => {
    expect(formatTime('08:00')).toBe('8:00')
    expect(formatTime('18:30')).toBe('18:30')
    expect(formatTime('00:05')).toBe('0:05')
  })
})

describe('formatDay', () => {
  test('weekday and month in full, no year in the current one', () => {
    expect(formatDay('2026-11-20T17:00:00Z', rome)).toBe('venerdì 20 novembre')
  })
  test('the year when it is not the current one', () => {
    expect(formatDay('2027-01-04T10:00:00Z', rome)).toBe('lunedì 4 gennaio 2027')
  })
  test('midnight belongs to the day it starts, in the given zone', () => {
    expect(formatDay('2026-11-19T23:00:00Z', rome)).toBe('venerdì 20 novembre')
    expect(formatDay('2026-11-19T23:00:00Z', { timeZone: 'America/New_York', now })).toBe(
      'giovedì 19 novembre',
    )
  })
  test('a wall date as the post keeps it', () => {
    expect(formatDay('2026-11-20', { now })).toBe('venerdì 20 novembre')
  })
})

describe('formatShort', () => {
  test('short weekday and month, then the time', () => {
    expect(formatShort('2026-11-20T17:00:00Z', rome)).toBe('ven 20 nov, 18:00')
    expect(formatShort('2026-11-21T08:00:00Z', rome)).toBe('sab 21 nov, 9:00')
  })
  test('the year when it is not the current one', () => {
    expect(formatShort('2025-11-03T09:00:00Z', rome)).toBe('lun 3 nov 2025, 10:00')
  })
  test('daylight saving: the clocks change on 25 October and 28 March', () => {
    // 25/10/2026 back to winter time: 1:30 UTC is 2:30 CET, 0:30 UTC was 2:30 CEST
    expect(formatShort('2026-10-25T00:30:00Z', rome)).toBe('dom 25 ott, 2:30')
    expect(formatShort('2026-10-25T01:30:00Z', rome)).toBe('dom 25 ott, 2:30')
    // 28/3/2027 forward to summer time: 1:00 UTC is 3:00 CEST, there is no 2:30
    expect(formatShort('2027-03-28T00:59:00Z', rome)).toBe('dom 28 mar 2027, 1:59')
    expect(formatShort('2027-03-28T01:00:00Z', rome)).toBe('dom 28 mar 2027, 3:00')
  })
  test('another zone than Rome', () => {
    expect(formatShort('2026-11-20T17:00:00Z', { timeZone: 'America/New_York', now })).toBe(
      'ven 20 nov, 12:00',
    )
  })
})

describe('formatWallShort', () => {
  test('the day and time a post keeps in its own zone', () => {
    expect(formatWallShort('2026-11-20', '08:00', now)).toBe('ven 20 nov, 8:00')
    expect(formatWallShort('2027-02-01', '18:00', now)).toBe('lun 1 feb 2027, 18:00')
  })
})

describe('formatRelative', () => {
  test('today, tomorrow and yesterday with the time', () => {
    expect(formatRelative('2026-11-19T17:00:00Z', rome)).toBe('oggi, 18:00')
    expect(formatRelative('2026-11-20T12:00:00Z', rome)).toBe('domani, 13:00')
    expect(formatRelative('2026-11-18T16:40:00Z', rome)).toBe('ieri, 17:40')
  })
  test('in a sentence: «ieri alle 18:42»', () => {
    expect(formatRelative('2026-11-18T17:42:00Z', { ...rome, sentence: true })).toBe(
      'ieri alle 18:42',
    )
    expect(formatRelative('2026-11-19T09:14:00Z', { ...rome, sentence: true })).toBe(
      'oggi alle 10:14',
    )
    expect(formatRelative('2026-11-20T07:00:00Z', { ...rome, sentence: true })).toBe(
      'domani alle 8:00',
    )
    expect(formatRelative('2026-11-24T07:00:00Z', { ...rome, sentence: true })).toBe(
      'mar 24 nov alle 8:00',
    )
  })
  test('the past week by its weekday, older by its date', () => {
    expect(formatRelative('2026-11-16T10:00:00Z', rome)).toBe('lun 16 nov')
    expect(formatRelative('2026-11-13T10:00:00Z', rome)).toBe('ven 13 nov')
    expect(formatRelative('2026-11-12T10:00:00Z', rome)).toBe('12 nov')
    expect(formatRelative('2026-11-03T10:00:00Z', rome)).toBe('3 nov')
    expect(formatRelative('2025-11-03T10:00:00Z', rome)).toBe('3 nov 2025')
  })
  test('what is still to come keeps its time', () => {
    expect(formatRelative('2026-11-21T08:00:00Z', rome)).toBe('sab 21 nov, 9:00')
    expect(formatRelative('2027-01-04T08:00:00Z', rome)).toBe('lun 4 gen 2027, 9:00')
  })
  test('without the time: only the day', () => {
    expect(formatRelative('2026-11-19T17:00:00Z', { ...rome, time: false })).toBe('oggi')
    expect(formatRelative('2026-11-18T17:00:00Z', { ...rome, time: false })).toBe('ieri')
    expect(formatRelative('2026-11-20T17:00:00Z', { ...rome, time: false })).toBe('domani')
    expect(formatRelative('2026-11-25T17:00:00Z', { ...rome, time: false })).toBe('mer 25 nov')
  })
  test('midnight: 23:59 is still today, 0:00 is tomorrow', () => {
    expect(formatRelative('2026-11-19T22:59:00Z', rome)).toBe('oggi, 23:59')
    expect(formatRelative('2026-11-19T23:00:00Z', rome)).toBe('domani, 0:00')
  })
  test('the day is counted in the zone given, not in the browser’s', () => {
    // 3:00 in Rome on the 20th is still the 19th in New York
    const ny = { timeZone: 'America/New_York', now }
    expect(formatRelative('2026-11-20T02:00:00Z', ny)).toBe('oggi, 21:00')
  })
})

describe('formatDate', () => {
  test('the date inside a sentence, the year only when it is not the current one', () => {
    expect(formatDate('2026-11-03T10:00:00Z', rome)).toBe('3 novembre')
    expect(formatDate('2025-11-03T10:00:00Z', rome)).toBe('3 novembre 2025')
    expect(formatDate('2026-12-01', { now })).toBe('1 dicembre')
  })
  test('with the time', () => {
    expect(formatDate('2026-11-20T17:00:00Z', { ...rome, time: true })).toBe(
      '20 novembre alle 18:00',
    )
  })
})

describe('edge cases', () => {
  test('a Date as well as a string', () => {
    expect(formatTime(new Date('2026-11-19T10:53:00Z'), rome)).toBe('11:53')
  })
  test('the day across the clock change is counted on the calendar', () => {
    const monday = { timeZone: 'Europe/Rome', now: new Date('2026-10-26T09:00:00Z') }
    expect(formatRelative('2026-10-25T08:00:00Z', monday)).toBe('ieri, 9:00')
    expect(formatRelative('2026-10-24T08:00:00Z', monday)).toBe('sab 24 ott')
  })
  test('the past week across the new year keeps the year', () => {
    const january = { timeZone: 'Europe/Rome', now: new Date('2027-01-02T09:00:00Z') }
    expect(formatRelative('2026-12-31T10:00:00Z', january)).toBe('gio 31 dic 2026')
  })
  test('a zone the runtime does not know falls back to the browser’s', () => {
    expect(() =>
      formatShort('2026-11-20T17:00:00Z', { timeZone: 'Europa/Nowhere', now }),
    ).not.toThrow()
  })
})

test('a wall date and time inside a sentence', () => {
  const now = new Date('2026-11-19T09:00:00Z')
  expect(formatWallSentence('2026-11-20', '08:00', now)).toBe('ven 20 nov alle 8:00')
  expect(formatWallSentence('2027-01-04', '18:30', now)).toBe('lun 4 gen 2027 alle 18:30')
})
