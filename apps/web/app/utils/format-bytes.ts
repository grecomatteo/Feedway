const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

/**
 * A size for people: decimal units, as the limits are written (8 MB is 8 000 000 bytes, plan 04
 * Task 8), one decimal from MB up, in Italian.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(bytes, 0)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit >= 2 && value < 100 ? 1 : 0
  const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(value)
  return `${number} ${UNITS[unit] ?? 'B'}`
}

/** A video's length as m:ss (or h:mm:ss). */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`
}
