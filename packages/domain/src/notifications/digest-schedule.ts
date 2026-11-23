import { instantToZoned, zonedToInstant } from '../time/index.js'

/** ISO weekdays, 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** When the person wants the morning digest (§12.4, Scelta 9). */
export interface DigestSchedule {
  enabled: boolean
  /** `HH:MM` in the person's zone */
  time: string
  days: readonly Weekday[]
}

export const DEFAULT_DIGEST: DigestSchedule = {
  enabled: true,
  time: '08:00',
  days: [1, 2, 3, 4, 5, 6, 7],
}

const DAY_MS = 86_400_000

function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

function weekday(localDate: string): Weekday {
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay()
  return (day === 0 ? 7 : day) as Weekday
}

/**
 * The first digest at or after `from`, or null when none will come. The local time is read in
 * the zone of that very day, so it stays 8:00 on the days the clocks change.
 */
export function nextDigestAt(schedule: DigestSchedule, from: Date, timeZone: string): Date | null {
  if (!schedule.enabled || schedule.days.length === 0) return null
  const today = instantToZoned(from, timeZone).localDate
  // today and the next seven days hold every weekday at least once after `from`
  for (let i = 0; i <= 7; i++) {
    const date = addDays(today, i)
    if (!schedule.days.includes(weekday(date))) continue
    const { instant } = zonedToInstant(date, schedule.time, timeZone)
    if (instant.getTime() >= from.getTime()) return instant
  }
  return null
}

/** The person's zone, else their first agency's, else the installation's (Scelta 9). */
export function digestTimeZone(
  userTimeZone: string | null,
  agencyTimeZones: readonly string[],
  fallback: string,
): string {
  return userTimeZone ?? agencyTimeZones[0] ?? fallback
}

/**
 * How long after its time a digest still goes out (Task 8): a worker that was down at 8:00 and is
 * back within the hour sends it; later, the morning's digest is no longer news.
 */
export const DIGEST_CATCH_UP_MS = 3_600_000

/**
 * The digest due now, if any: its time has come within the catch-up window. `date` is the
 * person's calendar day, the key that sends it once (P7).
 */
export function dueDigest(
  schedule: DigestSchedule,
  now: Date,
  timeZone: string,
): { date: string; at: Date } | null {
  const at = nextDigestAt(schedule, new Date(now.getTime() - DIGEST_CATCH_UP_MS), timeZone)
  if (!at || at.getTime() > now.getTime()) return null
  return { date: instantToZoned(at, timeZone).localDate, at }
}
