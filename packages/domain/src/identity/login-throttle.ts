const FREE_ATTEMPTS = 5
const BASE_DELAY_MS = 30_000
const MAX_DELAY_MS = 900_000

/** Delay before the next attempt after `consecutiveFailures`: none below 5, then doubling from 30 s up to 15 min. */
export function loginDelayMs(consecutiveFailures: number): number {
  // A broken counter fails closed.
  if (Number.isNaN(consecutiveFailures)) return MAX_DELAY_MS
  if (consecutiveFailures < FREE_ATTEMPTS) return 0
  const exponent = Math.min(consecutiveFailures - FREE_ATTEMPTS, 10)
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS)
}
