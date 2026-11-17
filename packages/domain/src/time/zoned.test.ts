import { expect, test } from 'vitest'
import { DomainError } from '../errors.js'
import { instantToZoned, zonedToInstant } from './zoned.js'

const ROME = 'Europe/Rome'

test('a normal day is the time of the zone, with nothing to adjust', () => {
  expect(zonedToInstant('2026-11-17', '18:00', ROME)).toEqual({
    instant: new Date('2026-11-17T17:00:00Z'),
    adjustment: 'none',
  })
  expect(zonedToInstant('2026-07-01', '00:00', ROME).instant).toEqual(
    new Date('2026-06-30T22:00:00Z'),
  )
})

test('the time that does not exist when the clocks go forward moves on by an hour (D-49)', () => {
  const r = zonedToInstant('2027-03-28', '02:30', ROME)
  expect(r).toEqual({ instant: new Date('2027-03-28T01:30:00Z'), adjustment: 'skipped_forward' })
  expect(instantToZoned(r.instant, ROME)).toEqual({
    localDate: '2027-03-28',
    localTime: '03:30',
    offset: '+02:00',
  })
})

test('the time that happens twice when the clocks go back is the first of the two (D-49)', () => {
  const r = zonedToInstant('2026-10-25', '02:30', ROME)
  expect(r).toEqual({ instant: new Date('2026-10-25T00:30:00Z'), adjustment: 'ambiguous_first' })
  expect(instantToZoned(r.instant, ROME).offset).toBe('+02:00')
  // an hour later the clocks read 02:30 again, in winter time
  expect(instantToZoned(new Date('2026-10-25T01:30:00Z'), ROME)).toEqual({
    localDate: '2026-10-25',
    localTime: '02:30',
    offset: '+01:00',
  })
})

test('the hours next to the change are not adjusted', () => {
  expect(zonedToInstant('2027-03-28', '03:00', ROME).adjustment).toBe('none')
  expect(zonedToInstant('2027-03-28', '01:59', ROME).adjustment).toBe('none')
  expect(zonedToInstant('2026-10-25', '03:00', ROME).adjustment).toBe('none')
})

test.each([
  ['2026-02-30', '10:00'],
  ['2026-13-01', '10:00'],
  ['2026-1-01', '10:00'],
  ['2026-11-17', '24:00'],
  ['2026-11-17', '12:60'],
  ['2026-11-17', '9:00'],
  ['domani', '10:00'],
])('%s %s is not a date and time', (date, time) => {
  expect(() => zonedToInstant(date, time, ROME)).toThrow(DomainError)
})

test('a zone that does not exist is refused', () => {
  expect(() => zonedToInstant('2026-11-17', '10:00', 'Europe/Atlantide')).toThrow(DomainError)
})
