import { addDays, weekday, type LocalDate } from '../calendar/dates.js'
import type { Weekday } from '../notifications/digest-schedule.js'
import { instantToZoned, zonedToInstant } from '../time/zoned.js'

// The usual times of a client (spec §11.6, plan 09 Task 9, Scelta 6): a weekday and a local
// time of the agency's zone, as «lun–ven 12:30 e 18:00». The next free slot is the first slot
// still ahead at which the client has no scheduled post at that exact minute. A slot's instant
// follows §9.2 (`zonedToInstant`): 02:30 of the day the clocks go forward is 03:30, of the day
// they go back the first 02:30.

export interface TimeSlot {
  /** ISO weekday: 1 Monday … 7 Sunday */
  weekday: Weekday
  /** `HH:MM` */
  localTime: string
}

/** A slot on a day: its instant and how it reads in the zone. */
export interface SlotTime {
  instant: Date
  localDate: LocalDate
  localTime: string
}

/** Ten a day: more than any client keeps, a ceiling for a script. */
export const TIME_SLOTS_MAX = 70

/** How far «Prossima fascia libera» looks: three months of slots all taken is no free slot. */
export const NEXT_FREE_SLOT_HORIZON_DAYS = 92

/** How far «Distribuisci sulle fasce libere» looks: a year, for 50 posts on one weekly slot. */
export const DISTRIBUTE_HORIZON_DAYS = 366

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MINUTE_MS = 60_000

export const isWeekday = (value: unknown): value is Weekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7

export const isSlotTime = (value: unknown): value is string =>
  typeof value === 'string' && TIME.test(value)

const compareSlots = (a: TimeSlot, b: TimeSlot) =>
  a.weekday - b.weekday || (a.localTime < b.localTime ? -1 : a.localTime > b.localTime ? 1 : 0)

export type TimeSlotsCheck =
  { ok: true; value: TimeSlot[] } | { ok: false; reason: 'invalid' | 'too_many'; index?: number }

/**
 * The slots as they are kept: valid, in order of the week and the time, a repeat once (the
 * editor's «Copia lun–ven» may give a slot that is already there).
 */
export function validateTimeSlots(
  raw: readonly { weekday: unknown; localTime: unknown }[],
): TimeSlotsCheck {
  const seen = new Map<string, TimeSlot>()
  for (const [index, slot] of raw.entries()) {
    if (!isWeekday(slot.weekday) || !isSlotTime(slot.localTime))
      return { ok: false, reason: 'invalid', index }
    seen.set(`${String(slot.weekday)} ${slot.localTime}`, {
      weekday: slot.weekday,
      localTime: slot.localTime,
    })
  }
  if (seen.size > TIME_SLOTS_MAX) return { ok: false, reason: 'too_many' }
  return { ok: true, value: [...seen.values()].sort(compareSlots) }
}

const minuteOf = (instant: Date) => Math.floor(instant.getTime() / MINUTE_MS)

/**
 * The slots after `after` (strictly), day by day in the zone for `horizonDays` days, skipping
 * the minutes in `taken`. Two slots that land on the same instant (02:30 and 03:30 of the day
 * the clocks go forward) count once.
 */
function* freeSlots(
  slots: readonly TimeSlot[],
  taken: Set<number>,
  after: Date,
  timeZone: string,
  horizonDays: number,
): Generator<SlotTime> {
  if (slots.length === 0) return
  const byDay = new Map<number, string[]>()
  for (const s of [...slots].sort(compareSlots)) {
    const times = byDay.get(s.weekday) ?? []
    times.push(s.localTime)
    byDay.set(s.weekday, times)
  }
  const first = instantToZoned(after, timeZone).localDate
  const afterMinute = minuteOf(after)
  for (let i = 0; i < horizonDays; i++) {
    const localDate = addDays(first, i)
    for (const localTime of byDay.get(weekday(localDate)) ?? []) {
      const { instant } = zonedToInstant(localDate, localTime, timeZone)
      const minute = minuteOf(instant)
      if (minute <= afterMinute || taken.has(minute)) continue
      taken.add(minute)
      yield { instant, ...instantToZoned(instant, timeZone) }
    }
  }
}

/**
 * The first free slot after `after`: `occupied` are the instants of the client's scheduled
 * posts. Null without slots, or with every slot taken for `NEXT_FREE_SLOT_HORIZON_DAYS`.
 */
export function nextFreeSlot(
  slots: readonly TimeSlot[],
  occupied: readonly Date[],
  after: Date,
  timeZone: string,
): SlotTime | null {
  const taken = new Set(occupied.map(minuteOf))
  for (const slot of freeSlots(slots, taken, after, timeZone, NEXT_FREE_SLOT_HORIZON_DAYS))
    return slot
  return null
}

/**
 * `count` free slots after `from`, in order, each one taken by the post before it
 * («Distribuisci sulle fasce libere», Scelta 7). Fewer when the year ahead has no more.
 */
export function distributeOnSlots(
  slots: readonly TimeSlot[],
  occupied: readonly Date[],
  count: number,
  from: Date,
  timeZone: string,
): SlotTime[] {
  const out: SlotTime[] = []
  if (count <= 0) return out
  const taken = new Set(occupied.map(minuteOf))
  for (const slot of freeSlots(slots, taken, from, timeZone, DISTRIBUTE_HORIZON_DAYS)) {
    out.push(slot)
    if (out.length === count) break
  }
  return out
}
