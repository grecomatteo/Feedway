import { describe, expect, it } from 'vitest'
import { groupByDay, libraryDay } from '../app/utils/library-day.ts'

const now = new Date('2026-11-19T09:00:00Z')
const rome = 'Europe/Rome'

describe('libraryDay (screen 19)', () => {
  it('today, yesterday, this week, then by month', () => {
    expect(libraryDay('2026-11-19T07:00:00Z', now, rome).label).toBe('Oggi')
    expect(libraryDay('2026-11-18T23:30:00Z', now, rome).label).toBe('Oggi')
    expect(libraryDay('2026-11-18T12:00:00Z', now, rome).label).toBe('Ieri')
    expect(libraryDay('2026-11-13T12:00:00Z', now, rome).label).toBe('Questa settimana')
    expect(libraryDay('2026-11-12T12:00:00Z', now, rome).label).toBe('novembre')
    expect(libraryDay('2026-10-02T12:00:00Z', now, rome).label).toBe('ottobre')
    expect(libraryDay('2025-12-02T12:00:00Z', now, rome).label).toBe('dicembre 2025')
  })

  it('keeps the files in their order, one group after the other', () => {
    const files = [
      { id: 'a', createdAt: '2026-11-19T08:00:00Z' },
      { id: 'b', createdAt: '2026-11-19T07:00:00Z' },
      { id: 'c', createdAt: '2026-11-16T07:00:00Z' },
      { id: 'd', createdAt: '2026-10-16T07:00:00Z' },
    ]
    expect(groupByDay(files, now, rome).map((g) => [g.label, g.files.map((f) => f.id)])).toEqual([
      ['Oggi', ['a', 'b']],
      ['Questa settimana', ['c']],
      ['ottobre', ['d']],
    ])
  })
})
