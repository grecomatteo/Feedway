/**
 * A date as the panel shows it: in the person's own time zone when they chose one, otherwise in
 * the browser's.
 */
export function formatDate(iso: string, withTime = false, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'long',
    ...(withTime ? { timeStyle: 'short' } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso))
}
