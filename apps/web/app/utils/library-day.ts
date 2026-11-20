/**
 * The groups of «Libreria» (screen 19): «Oggi», «Ieri», «Questa settimana», then by month
 * («ottobre», «dicembre 2025»), on the calendar of the person's zone. The files come newest
 * first, so each group follows the one before.
 */
export interface LibraryDay {
  key: string
  label: string
}

const dayOf = (at: Date, timeZone?: string) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(at)

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export function libraryDay(
  createdAt: string | Date,
  now = new Date(),
  timeZone?: string,
): LibraryDay {
  const day = dayOf(new Date(createdAt), timeZone)
  const today = dayOf(now, timeZone)
  const ago = daysBetween(day, today)
  if (ago <= 0) return { key: 'today', label: 'Oggi' }
  if (ago === 1) return { key: 'yesterday', label: 'Ieri' }
  if (ago < 7) return { key: 'week', label: 'Questa settimana' }
  const [year, month] = day.split('-')
  const name = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${year ?? ''}-${month ?? ''}-15T12:00:00Z`),
  )
  return {
    key: `${year ?? ''}-${month ?? ''}`,
    label: year === today.slice(0, 4) ? name : `${name} ${year ?? ''}`,
  }
}

/** Files in their groups, in the order they came. */
export function groupByDay<T extends { createdAt: string }>(
  files: readonly T[],
  now = new Date(),
  timeZone?: string,
): (LibraryDay & { files: T[] })[] {
  const groups: (LibraryDay & { files: T[] })[] = []
  for (const file of files) {
    const day = libraryDay(file.createdAt, now, timeZone)
    const last = groups.at(-1)
    if (last?.key === day.key) last.files.push(file)
    else groups.push({ ...day, files: [file] })
  }
  return groups
}
