// The day and the time of a post chosen without the browser's own fields (plan R7): a month as
// weeks from Monday, moving by days and months on a wall date, and an hour typed the way people
// write it («18», «1830», «18.30», «8:5»). Wall dates only: no zone is involved.

const WALL = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (n: number) => String(n).padStart(2, '0')
const wall = (d: Date) =>
  `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
function utc(date: string): Date {
  const m = WALL.exec(date)
  if (!m) throw new Error(`not a wall date: ${date}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

/** `date` moved by `days` days on the calendar. */
export function addDays(date: string, days: number): string {
  const d = utc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return wall(d)
}

/** The same day `months` months away, or the month's last day when it has fewer (31 → 30). */
export function addMonths(date: string, months: number): string {
  const d = utc(date)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return wall(d)
}

/** «2026-11»: the month a date is in. */
export const monthOf = (date: string) => date.slice(0, 7)

export interface GridDay {
  date: string
  /** false for the days of the months before and after, shown to fill the weeks */
  inMonth: boolean
}

/** The month of `date` as whole weeks from Monday to Sunday (4 to 6 of them). */
export function monthGrid(date: string): GridDay[][] {
  const first = `${monthOf(date)}-01`
  // 0 = Monday
  const lead = (utc(first).getUTCDay() + 6) % 7
  let day = addDays(first, -lead)
  const weeks: GridDay[][] = []
  do {
    const week: GridDay[] = []
    for (let i = 0; i < 7; i++) {
      week.push({ date: day, inMonth: monthOf(day) === monthOf(date) })
      day = addDays(day, 1)
    }
    weeks.push(week)
  } while (monthOf(day) === monthOf(date))
  return weeks
}

/**
 * An hour as typed, on a 24-hour clock: «18», «18:30», «18.30», «1830», «830», «8:5» (8:05).
 * Null when it is not one.
 */
export function parseTime(input: string): string | null {
  const s = input.trim().replace(/\s+/g, '')
  let h: number
  let m: number
  const sep = /^(\d{1,2})[:.,h](\d{1,2})$/.exec(s)
  if (sep) {
    h = Number(sep[1])
    m = Number(sep[2])
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s)
    m = 0
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2))
    m = Number(s.slice(-2))
  } else return null
  if (h > 23 || m > 59) return null
  return `${pad(h)}:${pad(m)}`
}

/** «00:00», «00:15» … «23:45»: the hours offered in the list, every `step` minutes. */
export function timeSteps(step = 15): string[] {
  const out: string[] = []
  for (let t = 0; t < 24 * 60; t += step) out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`)
  return out
}
