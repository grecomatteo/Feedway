import { describe, expect, it } from 'vitest'
import { addDays, addMonths, monthGrid, parseTime, timeSteps } from '../app/utils/day-time.ts'

describe('day and time of a post', () => {
  it('moves by days across months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2026-11-19', 7)).toBe('2026-11-26')
  })

  it('moves by months, keeping the last day of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-20', 2)).toBe('2027-01-20')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('draws a month as whole weeks from Monday', () => {
    const weeks = monthGrid('2026-11-19')
    // 1 November 2026 is a Sunday: the first week starts on Monday 26 October
    expect(weeks[0]?.[0]).toEqual({ date: '2026-10-26', inMonth: false })
    expect(weeks[0]?.[6]).toEqual({ date: '2026-11-01', inMonth: true })
    expect(weeks.at(-1)?.at(-1)?.date).toBe('2026-12-06')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30)
  })

  it('reads an hour as people type it', () => {
    expect(parseTime('18')).toBe('18:00')
    expect(parseTime('18:30')).toBe('18:30')
    expect(parseTime('18.30')).toBe('18:30')
    expect(parseTime('1830')).toBe('18:30')
    expect(parseTime('830')).toBe('08:30')
    expect(parseTime(' 8:5 ')).toBe('08:05')
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('18:60')).toBeNull()
    expect(parseTime('sei')).toBeNull()
    expect(parseTime('')).toBeNull()
  })

  it('offers the hours every quarter', () => {
    const list = timeSteps()
    expect(list).toHaveLength(96)
    expect(list[0]).toBe('00:00')
    expect(list[73]).toBe('18:15')
    expect(list.at(-1)).toBe('23:45')
  })
})
