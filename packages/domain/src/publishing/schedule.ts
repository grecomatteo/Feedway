import { DomainError } from '../errors.js'

// When each step happens (§9.4, §9.5, §9.6; plan 07, D-77 b and Scelta 4). Every interval is
// in real minutes between instants, so a change of time never stretches or shortens one.

const MINUTE_MS = 60_000

/** §9.5: new attempts 1, 5 and 15 minutes after the failed step. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15] as const
/** §9.6: checks 3, 10 and 30 minutes after publishing. */
export const VERIFY_DELAYS_MINUTES = [3, 10, 30] as const
/** §9.4: preparing starts 15 minutes before the post. */
export const PREPARE_LEAD_MINUTES = 15
/** D-77 (b): a publication does not start more than 15 minutes after its time. */
export const MAX_LATENESS_MINUTES = 15
/** Scelta 4: the post is checked again 3 hours before it goes out. */
export const RECHECK_LEAD_MINUTES = 180

const plusMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MINUTE_MS)
const latest = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b)

function delayOf(delays: readonly number[], n: number, name: string): number | null {
  if (!Number.isInteger(n) || n < 1)
    throw new DomainError('VALIDATION', `${name} must be a positive whole number`, { [name]: n })
  return delays[n - 1] ?? null
}

/**
 * When to try again after the attempt number `attempt` (1 = the first) failed; `null` when
 * the attempts are over and the destination goes to `failed`.
 */
export function nextAttemptAt(failedAt: Date, attempt: number): Date | null {
  const delay = delayOf(RETRY_DELAYS_MINUTES, attempt, 'attempt')
  return delay === null ? null : plusMinutes(failedAt, delay)
}

/** When to run the verification number `round` (1 = the first); `null` after the last. */
export function verifyAt(publishedAt: Date, round: number): Date | null {
  const delay = delayOf(VERIFY_DELAYS_MINUTES, round, 'round')
  return delay === null ? null : plusMinutes(publishedAt, delay)
}

/** 15 minutes before the post, or now when fewer are left (or its time has passed). */
export function prepareAt(scheduledAt: Date, now: Date): Date {
  return latest(plusMinutes(scheduledAt, -PREPARE_LEAD_MINUTES), now)
}

/**
 * D-77 (b): more than 15 minutes after the time, the first start of a publication does not
 * happen. Only the first start: the attempts after an error do not ask.
 */
export function isTooLate(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() > MAX_LATENESS_MINUTES * MINUTE_MS
}

/** Scelta 4: 3 hours before the post, or now when fewer are left. */
export function recheckAt(scheduledAt: Date, now: Date): Date {
  return latest(plusMinutes(scheduledAt, -RECHECK_LEAD_MINUTES), now)
}
