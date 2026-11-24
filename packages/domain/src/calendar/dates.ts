import { DomainError } from '../errors.js'
import { instantToZoned, zonedToInstant } from '../time/zoned.js'

// The days of the calendar (spec §11.4, plan 09 Task 2): local dates of the agency's zone
// (D-58), counted as dates and never as 24 hours, so a day of 23 or 25 hours stays one day.

/** `YYYY-MM-DD`, a day of the agency's calendar. */
export type LocalDate = string
/** `YYYY-MM`, a month of the calendar. */
export type LocalMonth = string

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH = /^(\d{4})-(\d{2})$/
const DAY_MS = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')
const fromUtc = (ms: number): LocalDate => {
  const d = new Date(ms)
  return `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The date's midnight read as UTC; null when it is not a real date. */
function utcOf(date: string): number | null {
  const m = DATE.exec(date)
  if (!m) return null
  const [year, month, day] = [m[1], m[2], m[3]].map(Number) as [number, number, number]
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  return back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : null
}

export const isLocalDate = (value: unknown): value is LocalDate =>
  typeof value === 'string' && utcOf(value) !== null

export const isLocalMonth = (value: unknown): value is LocalMonth =>
  typeof value === 'string' && MONTH.test(value) && isLocalDate(`${value}-01`)

function mustDate(date: LocalDate): number {
  const ms = utcOf(date)
  if (ms === null) throw new DomainError('VALIDATION', 'not a date', { date })
  return ms
}

/** The date `days` later (earlier when negative). */
export const addDays = (date: LocalDate, days: number): LocalDate =>
  fromUtc(mustDate(date) + days * DAY_MS)

/** The days from `from` to `to`, both counted: 1 for the same day. */
export const daysBetween = (from: LocalDate, to: LocalDate): number =>
  Math.round((mustDate(to) - mustDate(from)) / DAY_MS) + 1

/** ISO weekday: 1 Monday … 7 Sunday. */
export const weekday = (date: LocalDate): number => {
  const day = new Date(mustDate(date)).getUTCDay()
  return day === 0 ? 7 : day
}

/** The week of the date, from its first day (`weekStart`, ISO weekday, Monday by default). */
export function weekOf(date: LocalDate, weekStart = 1): LocalDate[] {
  const back = (weekday(date) - weekStart + 7) % 7
  const first = addDays(date, -back)
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/** The 6×7 days the month's grid shows, from the first day of the week that holds the 1st. */
export function monthGrid(month: LocalMonth, weekStart = 1): LocalDate[] {
  if (!isLocalMonth(month)) throw new DomainError('VALIDATION', 'not a month', { month })
  const [first] = weekOf(`${month}-01`, weekStart)
  return Array.from({ length: 42 }, (_, i) => addDays(first as LocalDate, i))
}

/** The agency's day at that instant. */
export const localDateOf = (instant: Date, timeZone: string): LocalDate =>
  instantToZoned(instant, timeZone).localDate

/**
 * The instants that bound the days `[from, to]` in the zone: the start of `from` and the start
 * of the day after `to`. A midnight that does not exist moves on as §9.2 says.
 */
export function dayBounds(
  from: LocalDate,
  to: LocalDate,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: zonedToInstant(from, '00:00', timeZone).instant,
    end: zonedToInstant(addDays(to, 1), '00:00', timeZone).instant,
  }
}
