import { describe, expect, test } from 'vitest'
import {
  addDays,
  dayBounds,
  daysBetween,
  isLocalDate,
  localDateOf,
  monthGrid,
  weekOf,
  weekday,
} from './dates.js'
import {
  EMPTY_CALENDAR_FILTERS,
  calendarStatuses,
  parseCalendarQuery,
  quickFilter,
  toCalendarQuery,
  type CalendarQuery,
} from './filters.js'

const ROME = 'Europe/Rome'
const A = '0190c0de-0000-7000-8000-000000000001'
const B = '0190c0de-0000-7000-8000-000000000002'

describe('days', () => {
  test('a date is a real one', () => {
    expect(isLocalDate('2027-02-28')).toBe(true)
    expect(isLocalDate('2027-02-29')).toBe(false)
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate('26-11-01')).toBe(false)
  })

  test('days are counted as dates, across the change of the clocks', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(daysBetween('2026-11-30', '2027-01-10')).toBe(42)
    expect(weekday('2026-11-23')).toBe(1)
    expect(weekday('2026-11-29')).toBe(7)
  })

  test('the grid of February 2027 starts on Monday 1 and holds six weeks', () => {
    const grid = monthGrid('2027-02')
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBe('2027-02-01')
    expect(grid[27]).toBe('2027-02-28')
    expect(grid[41]).toBe('2027-03-14')
  })

  test('the grid of November 2026 starts with the end of October', () => {
    const grid = monthGrid('2026-11')
    expect(grid[0]).toBe('2026-10-26')
    expect(grid[6]).toBe('2026-11-01')
    expect(grid[41]).toBe('2026-12-06')
    // a week that starts on Sunday
    expect(monthGrid('2026-11', 7)[0]).toBe('2026-11-01')
  })

  test('the week of a day, Monday first', () => {
    expect(weekOf('2026-11-25')).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ])
    expect(weekOf('2026-11-23')[0]).toBe('2026-11-23')
    expect(weekOf('2026-11-29')[0]).toBe('2026-11-23')
  })

  test('a post at 02:30 of the two changes of the clocks stays in its day', () => {
    // 25/10/2026: 02:30 happens twice; 28/03/2027: it does not exist and becomes 03:30
    expect(localDateOf(new Date('2026-10-25T00:30:00Z'), ROME)).toBe('2026-10-25')
    expect(localDateOf(new Date('2026-10-25T01:30:00Z'), ROME)).toBe('2026-10-25')
    expect(localDateOf(new Date('2027-03-28T01:30:00Z'), ROME)).toBe('2027-03-28')
  })

  test('the bounds of the days are the zone midnights: days of 25 and 23 hours', () => {
    const autumn = dayBounds('2026-10-25', '2026-10-25', ROME)
    expect(autumn.start).toEqual(new Date('2026-10-24T22:00:00Z'))
    expect(autumn.end).toEqual(new Date('2026-10-25T23:00:00Z'))
    const spring = dayBounds('2027-03-28', '2027-03-28', ROME)
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3_600_000)
  })
})

describe('the address', () => {
  const full: CalendarQuery = {
    view: 'week',
    date: '2026-12-01',
    filters: {
      workspaceIds: [A],
      accountIds: [A, B],
      platforms: ['instagram'],
      types: ['reel', 'story'],
      statuses: ['scheduled', 'failed'],
      authorIds: [B],
      labelIds: [A],
      quick: 'with_problem',
      show: 'plan',
    },
  }

  test('filters go to the address and come back the same', () => {
    const address = toCalendarQuery(full)
    expect(address).toEqual({
      vista: 'settimana',
      da: '2026-12-01',
      cliente: A,
      account: `${A},${B}`,
      piattaforma: 'instagram',
      tipo: 'reel,storia',
      stato: 'programmato,non-uscito',
      autore: B,
      etichetta: A,
      rapido: 'con-problema',
      mostra: 'piano',
    })
    expect(parseCalendarQuery(address)).toEqual(full)
  })

  test('the defaults leave the address empty', () => {
    const empty = { view: null, date: null, filters: EMPTY_CALENDAR_FILTERS }
    expect(toCalendarQuery(empty)).toEqual({})
    expect(parseCalendarQuery({})).toEqual(empty)
  })

  test('values the address does not know are left out, never an error', () => {
    expect(
      parseCalendarQuery({
        vista: 'anno',
        da: '2026-02-30',
        stato: ['programmato,boh', 'pubblicato', null],
        tipo: 42,
        cliente: 'not-an-id',
        account: `${A.toUpperCase()},${A}`,
        mostra: 'tutto',
      }),
    ).toEqual({
      view: null,
      date: null,
      filters: {
        ...EMPTY_CALENDAR_FILTERS,
        statuses: ['scheduled', 'published'],
        accountIds: [A],
      },
    })
  })
})

describe('quick filters', () => {
  test('«Oggi» at 23:59 and at 00:00 of Rome is the day of Rome', () => {
    // 23:59 of 24/11 in Rome is 22:59 UTC; 00:00 of 25/11 is 23:00 UTC
    expect(quickFilter('today', new Date('2026-11-24T22:59:00Z'), ROME)).toMatchObject({
      from: '2026-11-24',
      to: '2026-11-24',
    })
    expect(quickFilter('today', new Date('2026-11-24T23:00:00Z'), ROME)).toMatchObject({
      from: '2026-11-25',
      to: '2026-11-25',
    })
  })

  test('«Questa settimana» from Monday to Sunday of Rome', () => {
    // Sunday 29/11 at 23:30 in Rome, already Monday nowhere else
    expect(quickFilter('this_week', new Date('2026-11-29T22:30:00Z'), ROME)).toMatchObject({
      from: '2026-11-23',
      to: '2026-11-29',
    })
  })

  test('the states of the posts, within the filter of the states', () => {
    const now = new Date('2026-11-24T10:00:00Z')
    expect(calendarStatuses({ statuses: [] }, null)).not.toContain('cancelled')
    expect(calendarStatuses({ statuses: ['cancelled'] }, null)).toEqual(['cancelled'])
    const problems = quickFilter('with_problem', now, ROME)
    expect(calendarStatuses({ statuses: [] }, problems)).toEqual([
      'partial',
      'failed',
      'problem',
      'paused',
    ])
    expect(calendarStatuses({ statuses: ['failed', 'published'] }, problems)).toEqual(['failed'])
    // «Da preparare» is the plan's: no post
    const plan = quickFilter('to_prepare', now, ROME)
    expect(plan.show).toBe('plan')
    expect(calendarStatuses({ statuses: [] }, plan)).toEqual([])
  })
})
