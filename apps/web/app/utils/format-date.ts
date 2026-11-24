/**
 * Dates and times as the panel says them, always in Italian and on a 24-hour clock: «venerdì 20
 * novembre», «ven 20 nov, 18:00», «oggi, 18:00», «ieri alle 18:42», «08:00». Every date the panel
 * shows goes through here, so no field ever shows the browser's own format (11/18/2026, 06:00 PM).
 *
 * An instant (an ISO string with its time) is shown in `timeZone`: the person's own zone when they
 * chose one, otherwise the browser's. A post's wall date and time («2026-11-20», «08:00») are
 * already in the post's zone and are shown as they are.
 */

export interface DateOptions {
  /** IANA zone; leave it out for the browser's. Ignored for a wall date. */
  timeZone?: string | null
  /** «now», for «oggi» and the current year; the browser's clock when left out. */
  now?: Date
}

const WALL_DATE = /^\d{4}-\d{2}-\d{2}$/
const WALL_TIME = /^(\d{1,2}):(\d{2})/

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = `${timeZone ?? ''}|${JSON.stringify(options)}`
  let f = formatters.get(key)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('it-IT', { ...options, ...(timeZone ? { timeZone } : {}) })
    } catch {
      // a zone the runtime does not know: the browser's, rather than a page that does not draw
      f = new Intl.DateTimeFormat('it-IT', options)
    }
    formatters.set(key, f)
  }
  return f
}

interface Parts {
  year: number
  month: number
  day: number
  weekdayLong: string
  weekdayShort: string
  monthLong: string
  monthShort: string
  hour: number
  minute: number
}

/** The calendar fields of an instant in a zone, or of a wall date as it is. */
function parts(at: string | Date, timeZone?: string | null): Parts {
  const wall = typeof at === 'string' && WALL_DATE.test(at)
  const date = wall ? new Date(`${at}T12:00:00Z`) : new Date(at)
  const zone = wall ? 'UTC' : (timeZone ?? undefined)
  const pick = (options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    formatter(zone, options)
      .formatToParts(date)
      .find((p) => p.type === type)?.value ?? ''
  const numeric = formatter(zone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(numeric.find((p) => p.type === type)?.value ?? 0)
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour'),
    minute: num('minute'),
    weekdayLong: pick({ weekday: 'long' }, 'weekday'),
    weekdayShort: pick({ weekday: 'short' }, 'weekday'),
    monthLong: pick({ month: 'long' }, 'month'),
    monthShort: pick({ month: 'short' }, 'month'),
  }
}

const clock = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
const yearOf = (p: Parts, now: Date, timeZone?: string | null) =>
  p.year === parts(now, timeZone).year ? '' : ` ${String(p.year)}`
/** Days from `now` to `p`, counted on the calendar of the zone (so midnight, not 24 hours). */
function dayOffset(p: Parts, now: Date, timeZone?: string | null): number {
  const n = parts(now, timeZone)
  return Math.round(
    (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(n.year, n.month - 1, n.day)) / 86_400_000,
  )
}

/** «8:00», «18:00»: an instant in the zone, or a wall time («08:00») as it is. */
export function formatTime(at: string | Date, options: DateOptions = {}): string {
  const wall = typeof at === 'string' && !at.includes('T') ? WALL_TIME.exec(at) : null
  if (wall) return clock(Number(wall[1]), Number(wall[2]))
  const p = parts(at, options.timeZone)
  return clock(p.hour, p.minute)
}

/** «venerdì 20 novembre», with the year only when it is not the current one. */
export function formatDay(at: string | Date, options: DateOptions = {}): string {
  const p = parts(at, options.timeZone)
  const now = options.now ?? new Date()
  return `${p.weekdayLong} ${String(p.day)} ${p.monthLong}${yearOf(p, now, options.timeZone)}`
}

/** «ven 20 nov», with the year only when it is not the current one. */
function shortDay(p: Parts, now: Date, timeZone?: string | null): string {
  return `${p.weekdayShort} ${String(p.day)} ${p.monthShort}${yearOf(p, now, timeZone)}`
}

/** «ven 20 nov, 18:00». */
export function formatShort(at: string | Date, options: DateOptions = {}): string {
  const p = parts(at, options.timeZone)
  return `${shortDay(p, options.now ?? new Date(), options.timeZone)}, ${clock(p.hour, p.minute)}`
}

/** «ven 20 nov, 8:00» from a post's wall date and time, which are already in the post's zone. */
export function formatWallShort(localDate: string, localTime: string, now = new Date()): string {
  return `${shortDay(parts(localDate), now)}, ${formatTime(localTime)}`
}

/** «ven 20 nov alle 8:00»: a post's wall date and time inside a sentence («Programmato per …»). */
export function formatWallSentence(localDate: string, localTime: string, now = new Date()): string {
  return `${shortDay(parts(localDate), now)} alle ${formatTime(localTime)}`
}

export interface RelativeOptions extends DateOptions {
  /** false: the day only («oggi», «lun 16 nov»). */
  time?: boolean
  /** true: the form inside a sentence, «ieri alle 18:42», «ven 20 nov alle 8:00». */
  sentence?: boolean
}

/**
 * The day from today: «oggi, 18:00», «domani, 13:00», «ieri, 17:40». The past week goes by its
 * weekday («lun 16 nov»), the rest of the past by its date («3 nov»); what is still to come keeps
 * its time («sab 21 nov, 9:00»), because that is what a person plans around.
 */
export function formatRelative(at: string | Date, options: RelativeOptions = {}): string {
  const { timeZone, time = true, sentence = false } = options
  const now = options.now ?? new Date()
  const p = parts(at, timeZone)
  const offset = dayOffset(p, now, timeZone)
  const near = ({ 0: 'oggi', 1: 'domani', [-1]: 'ieri' } as Record<number, string>)[offset]
  const withTime = (day: string) =>
    time ? `${day}${sentence ? ' alle ' : ', '}${clock(p.hour, p.minute)}` : day
  if (near) return withTime(near)
  if (offset > 0) return withTime(shortDay(p, now, timeZone))
  if (offset >= -6) return shortDay(p, now, timeZone)
  return `${String(p.day)} ${p.monthShort}${yearOf(p, now, timeZone)}`
}

/**
 * «20 novembre», «3 novembre 2025», «20 novembre alle 18:00»: the date inside a sentence that
 * already says «il», «al» or «dal» («Aggiunta il 3 novembre», «scade il 20 novembre alle 18:00»).
 */
export function formatDate(
  at: string | Date,
  options: DateOptions & { time?: boolean } = {},
): string {
  const p = parts(at, options.timeZone)
  const day = `${String(p.day)} ${p.monthLong}${yearOf(p, options.now ?? new Date(), options.timeZone)}`
  return options.time ? `${day} alle ${clock(p.hour, p.minute)}` : day
}
