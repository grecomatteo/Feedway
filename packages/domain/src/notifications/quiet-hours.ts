import { instantToZoned } from '../time/index.js'

/** Local times `HH:MM` in the person's zone; `start` after `end` crosses midnight. */
export interface QuietHours {
  start: string
  end: string
}

/** From `start` included to `end` excluded; the same time for both means none. */
export function inQuietHours(quiet: QuietHours | null, now: Date, timeZone: string): boolean {
  if (!quiet || quiet.start === quiet.end) return false
  // `HH:MM` strings compare as times
  const time = instantToZoned(now, timeZone).localTime
  return quiet.start < quiet.end
    ? time >= quiet.start && time < quiet.end
    : time >= quiet.start || time < quiet.end
}
