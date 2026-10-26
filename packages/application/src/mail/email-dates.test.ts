import { expect, test } from 'vitest'
import { dayAndTime, isSameDay, timeOfDay, usableTimeZone } from './email-dates.js'

const at = new Date('2026-10-29T18:20:00Z')

test('a day written out in full, in the time zone given', () => {
  expect(dayAndTime(at, 'Europe/Rome')).toEqual({ day: 'giovedì 29 ottobre', time: '19:20' })
  expect(dayAndTime(at, 'Europe/Rome', { year: true }).day).toBe('giovedì 29 ottobre 2026')
  expect(dayAndTime(at, 'America/New_York')).toEqual({ day: 'giovedì 29 ottobre', time: '14:20' })
})

test('the time alone, with two digits', () => {
  expect(timeOfDay(new Date('2026-10-26T08:05:00Z'), 'Europe/Rome')).toBe('09:05')
})

test('same day is read in the time zone, not in UTC', () => {
  const late = new Date('2026-10-26T22:30:00Z') // 23:30 in Rome
  const after = new Date('2026-10-26T23:30:00Z') // 00:30 of the 27th in Rome
  expect(isSameDay(late, after, 'UTC')).toBe(true)
  expect(isSameDay(late, after, 'Europe/Rome')).toBe(false)
})

test('an unknown or missing time zone falls back', () => {
  expect(usableTimeZone('Europe/Paris', 'Europe/Rome')).toBe('Europe/Paris')
  expect(usableTimeZone(null, 'Europe/Rome')).toBe('Europe/Rome')
  expect(usableTimeZone('Marte/Base', 'Europe/Rome')).toBe('Europe/Rome')
})
