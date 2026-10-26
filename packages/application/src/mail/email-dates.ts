/** Dates as the emails write them, in Italian: "giovedì 29 ottobre" and "19:20". */

export function usableTimeZone(timeZone: string | null | undefined, fallback: string): string {
  if (!timeZone) return fallback
  try {
    new Intl.DateTimeFormat('it-IT', { timeZone })
    return timeZone
  } catch {
    return fallback
  }
}

export function timeOfDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at)
}

export function dayAndTime(
  at: Date,
  timeZone: string,
  options: { year?: boolean } = {},
): { day: string; time: string } {
  const day = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(options.year ? { year: 'numeric' } : {}),
    timeZone,
  }).format(at)
  return { day, time: timeOfDay(at, timeZone) }
}

const calendarDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(at)

export function isSameDay(a: Date, b: Date, timeZone: string): boolean {
  return calendarDay(a, timeZone) === calendarDay(b, timeZone)
}

/** "lunedì 26 ottobre" → "Lunedì 26 ottobre", for the start of a line. */
export const capitalize = (text: string) =>
  text.charAt(0).toLocaleUpperCase('it-IT') + text.slice(1)
