import { DomainError } from '../errors.js'

// Local dates and times of a zone, with `Intl` only (plan 05, Scelta 4; D-49). The planner of
// stage 9 uses the same functions.

/**
 * `skipped_forward`: the time does not exist (the clocks go forward) and moves on by the gap;
 * `ambiguous_first`: the time happens twice (the clocks go back) and the first is taken.
 */
export type ZonedAdjustment = 'none' | 'skipped_forward' | 'ambiguous_first'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^(\d{2}):(\d{2})$/
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      throw new DomainError('VALIDATION', 'unknown time zone', { timeZone })
    }
    formatters.set(timeZone, f)
  }
  return f
}

/** The wall clock of the zone at that instant, read as if it were UTC. */
function wallClockMs(instantMs: number, timeZone: string): number {
  const parts = formatterOf(timeZone).formatToParts(new Date(instantMs))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
}

/** Minutes ahead of UTC at that instant (+120 for Rome in summer). */
const offsetMinutes = (instantMs: number, timeZone: string) =>
  Math.round((wallClockMs(instantMs, timeZone) - Math.floor(instantMs / 1000) * 1000) / 60_000)

function parseWallClock(localDate: string, localTime: string): number {
  const d = DATE.exec(localDate)
  const t = TIME.exec(localTime)
  if (!d || !t) throw new DomainError('VALIDATION', 'not a date and time', { localDate, localTime })
  const [year, month, day] = [d[1], d[2], d[3]].map(Number) as [number, number, number]
  const [hour, minute] = [t[1], t[2]].map(Number) as [number, number]
  const ms = Date.UTC(year, month - 1, day, hour, minute)
  const back = new Date(ms)
  const valid =
    hour < 24 &&
    minute < 60 &&
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
  if (!valid) throw new DomainError('VALIDATION', 'not a date and time', { localDate, localTime })
  return ms
}

/**
 * The instant of a local date (`YYYY-MM-DD`) and time (`HH:MM`) in the zone. The offsets of the
 * day before and the day after are the only ones the time can have: the instants they give
 * that read back as that time are its real occurrences.
 */
export function zonedToInstant(
  localDate: string,
  localTime: string,
  timeZone: string,
): { instant: Date; adjustment: ZonedAdjustment } {
  const wall = parseWallClock(localDate, localTime)
  const before = offsetMinutes(wall - DAY_MS, timeZone)
  const after = offsetMinutes(wall + DAY_MS, timeZone)
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset * 60_000)
    .filter((ms) => wallClockMs(ms, timeZone) === wall)
    .sort((a, b) => a - b)
  const [first] = candidates
  if (first === undefined)
    // in the gap: read with the offset in force before it, the time lands after it
    return { instant: new Date(wall - before * 60_000), adjustment: 'skipped_forward' }
  return {
    instant: new Date(first),
    adjustment: candidates.length > 1 ? 'ambiguous_first' : 'none',
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The local date, time (`HH:MM`) and offset (`+02:00`) of an instant in the zone. */
export function instantToZoned(
  instant: Date,
  timeZone: string,
): { localDate: string; localTime: string; offset: string } {
  const wall = new Date(wallClockMs(instant.getTime(), timeZone))
  const offset = offsetMinutes(instant.getTime(), timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return {
    localDate: `${String(wall.getUTCFullYear())}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    localTime: `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`,
    offset: `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  }
}
