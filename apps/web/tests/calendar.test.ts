import { describe, expect, it } from 'vitest'
import {
  cardLook,
  periodLabel,
  periodOf,
  postsByDay,
  shiftDate,
  shownInDay,
} from '../app/utils/calendar.ts'

describe('periodOf', () => {
  it('gives the 42 days of the month grid, from the Monday before the 1st', () => {
    const p = periodOf('month', '2026-11-19')
    expect(p.days).toHaveLength(42)
    expect(p.from).toBe('2026-10-26')
    expect(p.to).toBe('2026-12-06')
  })

  it('gives February 2027 from Monday 1st', () => {
    expect(periodOf('month', '2027-02-14').from).toBe('2027-02-01')
  })

  it('gives the week from Monday to Sunday, across a change of hour', () => {
    const p = periodOf('week', '2026-10-25')
    expect(p.days).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ])
  })
})

describe('shiftDate', () => {
  it('moves a month to the 1st of the next or previous one, across the year', () => {
    expect(shiftDate('month', '2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('month', '2026-03-31', -1)).toBe('2026-02-01')
  })

  it('moves a week by seven days', () => {
    expect(shiftDate('week', '2026-11-19', 1)).toBe('2026-11-26')
    expect(shiftDate('week', '2026-11-19', -1)).toBe('2026-11-12')
  })
})

describe('periodLabel', () => {
  it('names the month with a capital', () => {
    expect(periodLabel('month', '2026-11-19')).toBe('Novembre 2026')
  })

  it('names a week inside a month, across two months and across two years', () => {
    expect(periodLabel('week', '2026-11-19')).toBe('16–22 novembre 2026')
    expect(periodLabel('week', '2026-12-02')).toBe('30 nov – 6 dic 2026')
    expect(periodLabel('week', '2026-12-30')).toBe('28 dic 2026 – 3 gen 2027')
  })
})

describe('postsByDay', () => {
  const post = (id: string, localDate: string | null, localTime: string | null) => ({
    id,
    localDate,
    localTime,
  })

  it('puts each post on its day by time, the drafts without a time last', () => {
    const days = postsByDay([
      post('a', '2026-11-19', '18:00'),
      post('b', '2026-11-19', null),
      post('c', '2026-11-19', '09:30'),
      post('d', '2026-11-20', '08:00'),
      post('e', null, null),
    ])
    expect(days.get('2026-11-19')?.map((p) => p.id)).toEqual(['c', 'a', 'b'])
    expect(days.get('2026-11-20')?.map((p) => p.id)).toEqual(['d'])
    expect([...days.keys()]).toHaveLength(2)
  })

  it('keeps the order of the server for the same time', () => {
    const days = postsByDay([post('x', '2026-11-19', '18:00'), post('y', '2026-11-19', '18:00')])
    expect(days.get('2026-11-19')?.map((p) => p.id)).toEqual(['x', 'y'])
  })
})

describe('shownInDay', () => {
  it('shows every card that fits', () => {
    expect(shownInDay(4, 4)).toEqual({ shown: 4, more: 0 })
  })

  it('never hides one card behind «+1»: one less and «+N»', () => {
    expect(shownInDay(5, 4)).toEqual({ shown: 3, more: 2 })
    expect(shownInDay(12, 4)).toEqual({ shown: 3, more: 9 })
  })
})

describe('cardLook', () => {
  const post = (status: string, tone: string) =>
    ({ kind: 'post', status, tone }) as Parameters<typeof cardLook>[0]

  it('says the state only where it asks to be looked at', () => {
    expect(cardLook(post('failed', 'danger'))).toBe('alert')
    expect(cardLook(post('paused', 'warning'))).toBe('alert')
    expect(cardLook(post('draft', 'neutral'))).toBe('draft')
    expect(cardLook(post('published', 'success'))).toBe('done')
    expect(cardLook(post('scheduled', 'info'))).toBe('normal')
  })

  it('draws a content of the plan dashed, whatever its state', () => {
    expect(cardLook({ kind: 'plan', status: null, tone: 'danger' })).toBe('plan')
  })
})
