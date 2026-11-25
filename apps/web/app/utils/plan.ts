import type { PlanItemDto, TimeSlotDto } from '@app/contracts'
import { addMonths, monthGrid, monthOf, type GridDay } from './day-time.ts'

// The editorial plan's small rules (spec §11.12, plan 09 Task 7), apart from the page so they are
// tested on their own: who writes and who prepares, the month of the address, the days a month
// shows and the state of a content, which moves on every minute in the panel.

export type PlanItem = PlanItemDto
export type PlanState = PlanItemDto['state']
/** in the order of the form, the landing's board: the reel first, the most planned */
export const PLAN_TYPES = ['reel', 'carousel', 'photo', 'story'] as const
export type PlanType = (typeof PLAN_TYPES)[number]

type Role = 'owner' | 'admin' | 'manager' | 'publisher' | 'editor' | 'viewer'
/** `plan.edit`: Publisher and above (§10.2, D-123.21) */
export const canEditPlan = (role: Role) => ['owner', 'admin', 'manager', 'publisher'].includes(role)
/** `plan.prepare`: Editor and above */
export const canPreparePlan = (role: Role) => canEditPlan(role) || role === 'editor'

/**
 * The state at `now`: prepared stays what the server read (a post stands for it); the others
 * move on with the clock from the two instants the server gives, so a page left open turns
 * yellow when the notification goes out (the same instant, Matteo 25/11) and red when late.
 */
export function planStateAt(
  item: Pick<PlanItem, 'state' | 'dueAt' | 'dueSoonAt'>,
  now: Date,
): PlanState {
  if (item.state === 'prepared') return 'prepared'
  if (now.getTime() > new Date(item.dueAt).getTime()) return 'late'
  if (now.getTime() >= new Date(item.dueSoonAt).getTime()) return 'due_soon'
  return 'to_prepare'
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** The month of the address (`?mese=2026-12`), else the one of `?giorno`, else the agency's month of today. */
export const planMonth = (asked: unknown, today: string, day: string | null = null): string =>
  typeof asked === 'string' && MONTH.test(asked) ? asked : monthOf(day ?? today)

/** The agency's wall date at `now` («2026-12-11»): what «today» and «past» mean in the plan. */
export function localToday(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** The day of the address (`?giorno=2026-12-11`, from a notification), or null. */
export const planDay = (asked: unknown): string | null =>
  typeof asked === 'string' && DAY.test(asked) ? asked : null

/** The month before or after. */
export const shiftMonth = (month: string, by: number) => monthOf(addMonths(`${month}-01`, by))

/** The whole weeks the month shows, from Monday: what the page reads (at most 42 days). */
export function planWeeks(month: string): GridDay[][] {
  return monthGrid(`${month}-01`)
}

/** The first and the last day of those weeks, for the read. */
export function planRange(month: string): { from: string; to: string } {
  const days = planWeeks(month).flat()
  return { from: days[0]?.date ?? `${month}-01`, to: days.at(-1)?.date ?? `${month}-01` }
}

/** The days of the month only, for the phone's list. */
export const monthDays = (month: string): string[] =>
  planWeeks(month)
    .flat()
    .filter((d) => d.inMonth)
    .map((d) => d.date)

/** The contents of each day, by time, those without a time last (as the server orders them). */
export function itemsByDay(items: readonly PlanItem[]): Map<string, PlanItem[]> {
  const byDay = new Map<string, PlanItem[]>()
  for (const item of items) {
    const day = byDay.get(item.localDate)
    if (day) day.push(item)
    else byDay.set(item.localDate, [item])
  }
  for (const day of byDay.values())
    day.sort((a, b) => {
      if (a.localTime === b.localTime) return a.title.localeCompare(b.title, 'it')
      if (a.localTime === null) return 1
      if (b.localTime === null) return -1
      return a.localTime < b.localTime ? -1 : 1
    })
  return byDay
}

/** «12 contenuti · 2 preparati»: what the month holds. */
export function monthCounts(items: readonly PlanItem[], month: string) {
  const inMonth = items.filter((i) => i.localDate.startsWith(`${month}-`))
  return { total: inMonth.length, prepared: inMonth.filter((i) => i.state === 'prepared').length }
}

/** The icon of a type, the same as the editor's. */
/**
 * The time a new content of `date` starts with (Matteo, 25/11): the first of the client's usual
 * times for that weekday that no content of the day has yet, so a day planned in a row fills its
 * slots one after the other; else the client's usual time for a post; else none.
 */
export function suggestedTime(
  date: string,
  slots: readonly TimeSlotDto[],
  items: readonly PlanItem[],
  fallback: string | null,
): string | null {
  // ISO weekday of a local date: 1 Monday … 7 Sunday
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
  const taken = new Set(items.filter((i) => i.localDate === date).map((i) => i.localTime))
  const free = slots
    .filter((s) => s.weekday === weekday && !taken.has(s.localTime))
    .map((s) => s.localTime)
    .sort()[0]
  return free ?? fallback
}

export const PLAN_TYPE_ICONS: Record<PlanType, string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}
