/** A date as the panel shows it, in the browser's time zone. */
export function formatDate(iso: string, withTime = false): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'long',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(new Date(iso))
}
