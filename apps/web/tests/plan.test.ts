import { describe, expect, it } from 'vitest'
import {
  canEditPlan,
  canPreparePlan,
  itemsByDay,
  localToday,
  monthCounts,
  monthDays,
  planDay,
  planMonth,
  planRange,
  planStateAt,
  planWeeks,
  shiftMonth,
  type PlanItem,
} from '../app/utils/plan.ts'

const item = (over: Partial<PlanItem>): PlanItem => ({
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  localDate: '2026-12-11',
  localTime: null,
  type: 'reel',
  title: 'Pane caldo',
  note: '',
  postId: null,
  state: 'to_prepare',
  dueAt: '2026-12-11T22:59:00.000Z',
  dueSoonAt: '2026-12-10T10:59:00.000Z',
  version: 1,
  ...over,
})

describe('who plans and who prepares', () => {
  it('writes the plan from Publisher up, prepares from Editor up', () => {
    expect(['owner', 'admin', 'manager', 'publisher'].every((r) => canEditPlan(r as never))).toBe(
      true,
    )
    expect(canEditPlan('editor')).toBe(false)
    expect(canPreparePlan('editor')).toBe(true)
    expect(canPreparePlan('viewer')).toBe(false)
    expect(canEditPlan('viewer')).toBe(false)
  })
})

describe('the state of a content on the clock', () => {
  const due = '2026-12-11T09:00:00.000Z'
  const dueSoon = '2026-12-09T21:00:00.000Z'
  it('turns yellow when the notification goes out and red after the reference instant', () => {
    const at = (iso: string) =>
      planStateAt({ state: 'to_prepare', dueAt: due, dueSoonAt: dueSoon }, new Date(iso))
    expect(at('2026-12-09T20:59:59.000Z')).toBe('to_prepare')
    expect(at('2026-12-09T21:00:00.000Z')).toBe('due_soon')
    expect(at('2026-12-11T09:00:00.000Z')).toBe('due_soon')
    expect(at('2026-12-11T09:00:00.001Z')).toBe('late')
  })

  it('keeps «prepared» as the server read it', () => {
    expect(
      planStateAt({ state: 'prepared', dueAt: due, dueSoonAt: dueSoon }, new Date('2027-01-01')),
    ).toBe('prepared')
  })
})

describe('the month of the page', () => {
  it('reads the month or the day of the address, else today', () => {
    expect(planMonth('2026-12', '2026-11-25')).toBe('2026-12')
    expect(planMonth('2026-13', '2026-11-25')).toBe('2026-11')
    expect(planMonth(['2026-12'], '2026-11-25')).toBe('2026-11')
    expect(planMonth(undefined, '2026-11-25', '2027-01-04')).toBe('2027-01')
    expect(planDay('2027-01-04')).toBe('2027-01-04')
    expect(planDay('2027-02-30x')).toBeNull()
    expect(planDay(undefined)).toBeNull()
  })

  it('moves across the years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
  })

  it('shows whole weeks from Monday, and reads exactly them', () => {
    const weeks = planWeeks('2026-12')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0]?.[0]?.date).toBe('2026-11-30')
    expect(planRange('2026-12')).toEqual({ from: '2026-11-30', to: '2027-01-03' })
    expect(monthDays('2026-12')).toHaveLength(31)
    expect(monthDays('2026-12')[0]).toBe('2026-12-01')
  })

  it('knows the agency’s today, not the browser’s', () => {
    const late = new Date('2026-12-10T23:30:00.000Z')
    expect(localToday('Europe/Rome', late)).toBe('2026-12-11')
    expect(localToday('America/New_York', late)).toBe('2026-12-10')
  })
})

describe('the contents of a day', () => {
  it('orders by time, those without one last, then by title', () => {
    const items = [
      item({ title: 'Senza ora' }),
      item({ title: 'Sera', localTime: '18:00' }),
      item({ title: 'B mattina', localTime: '09:00' }),
      item({ title: 'A mattina', localTime: '09:00' }),
      item({ title: 'Altro giorno', localDate: '2026-12-12' }),
    ]
    const byDay = itemsByDay(items)
    expect(byDay.get('2026-12-11')?.map((i) => i.title)).toEqual([
      'A mattina',
      'B mattina',
      'Sera',
      'Senza ora',
    ])
    expect(byDay.get('2026-12-12')).toHaveLength(1)
  })

  it('counts the month only, not the days of the weeks around it', () => {
    const items = [
      item({ localDate: '2026-11-30' }),
      item({ localDate: '2026-12-01', state: 'prepared' }),
      item({ localDate: '2026-12-31' }),
    ]
    expect(monthCounts(items, '2026-12')).toEqual({ total: 2, prepared: 1 })
  })
})
