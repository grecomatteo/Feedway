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
/**
 * Review of stage 7 (R4): a first publication never goes out more than 60 minutes after its time
 * (or its «Riprova»), whatever held it on the way: a worker stopped during the preparation, the
 * attempts after an error, an Instagram quota. The attempts of §9.5 (1, 5, 15 minutes) fit in.
 */
export const LATEST_START_MINUTES = 60
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

/**
 * When to run the search number `round` (1 = the first) after the call that became uncertain at
 * `uncertainAt`; `null` after the last: the destination is `failed` (`uncertain_not_found`).
 */
export function searchAt(uncertainAt: Date, round: number): Date | null {
  const delay = delayOf(UNCERTAIN_SEARCH_DELAYS_MINUTES, round, 'round')
  return delay === null ? null : plusMinutes(uncertainAt, delay)
}

/** 15 minutes before the post, or now when fewer are left (or its time has passed). */
export function prepareAt(scheduledAt: Date, now: Date): Date {
  return latest(plusMinutes(scheduledAt, -PREPARE_LEAD_MINUTES), now)
}

/**
 * D-77 (b) and D-118: more than 15 minutes after the time, nothing of a publication starts or
 * goes on, the attempts after an error too; only a file still being processed since a
 * preparation that started in time waits longer (up to `isPastLatestStart`). `startAt` is the
 * post's time, or the time of the «Riprova» after `too_late` (Scelta 1: that one publishes at
 * once, and the post keeps its time for the history).
 */
export function isTooLate(startAt: Date, now: Date): boolean {
  return now.getTime() - startAt.getTime() > MAX_LATENESS_MINUTES * MINUTE_MS
}

/** R4: past this, nothing of a first publication starts any more; `startAt` as `isTooLate`. */
export function isPastLatestStart(startAt: Date, now: Date): boolean {
  return now.getTime() - startAt.getTime() > LATEST_START_MINUTES * MINUTE_MS
}

/** Scelta 4: 3 hours before the post, or now when fewer are left. */
export function recheckAt(scheduledAt: Date, now: Date): Date {
  return latest(plusMinutes(scheduledAt, -RECHECK_LEAD_MINUTES), now)
}

/** Plan 07 «Lavori pesanti»: preparations on Meta running at once, per agency and per account. */
export const PREPARE_PER_ORGANIZATION = 3
export const PREPARE_PER_ACCOUNT = 1

/**
 * How long a step of the worker may run (pg-boss `expireInSeconds`). Each call to Meta has its
 * own timeout, below; a carousel makes its containers one after the other in one step, so a
 * very slow Meta can reach this: the step then stops as a temporary error, with the ids made so
 * far saved (D-118).
 */
export const TARGET_STEP_EXPIRE_SECONDS = 300
/** A preparation's claim outlasts its job: a worker gone frees the account after this. */
export const PREPARE_CLAIM_MINUTES = 6
/**
 * A destination still `publishing` this long after the call started was left by a worker that
 * stopped halfway: the reconciler takes it as an uncertain outcome (`unknown`), never redoes it.
 */
export const PUBLISHING_STALE_MINUTES = 6
/** §9.5, Scelta 7: the searches after an uncertain call, 2, 5 and 15 minutes later. */
export const UNCERTAIN_SEARCH_DELAYS_MINUTES = [2, 5, 15] as const
/** §9.5: the first search after an uncertain call, 2 minutes later. */
export const UNCERTAIN_FIRST_SEARCH_MINUTES = UNCERTAIN_SEARCH_DELAYS_MINUTES[0]
/** A preparation waiting for its turn, a file or a copy looks again after this. */
export const PREPARE_TURN_WAIT_SECONDS = 20
export const PREPARE_FILE_WAIT_MINUTES = 1
