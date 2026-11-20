// The slowing down of the publishing (§8.6, plan 07 «Rallentamento»): the worker reads Meta's
// usage after every call and, above 80%, moves the next steps of that account, or of every
// account of the agency when the app's usage is high. `publish` moves only above 95%, so a post
// does not miss its time for a limit still far. A reading only holds for its wait: once that is
// over the step runs, and its answer is the next reading.

/** Above this usage (in percent) the steps wait. */
export const SLOW_DOWN_ABOVE_PERCENT = 80
/** `publish` waits only above this one. */
export const SLOW_DOWN_PUBLISH_ABOVE_PERCENT = 95
/** At most this wait, whatever Meta says. */
export const SLOW_DOWN_MAX_MINUTES = 5
/**
 * The wait when Meta says nothing of it: the app's usage (`X-App-Usage`) has no time to
 * regain, and an account's may say 0 (D-111).
 */
export const SLOW_DOWN_DEFAULT_MINUTES = 1

const MINUTE_MS = 60_000

/** An answer's usage as the worker saved it, with when it was read. */
export interface UsageReading {
  /** `X-Business-Use-Case-Usage` of the account; null: the answer did not say. */
  accountPercent: number | null
  /** `X-App-Usage`, the same for every account of the agency's app; null: not said. */
  appPercent: number | null
  /** What Meta says to wait before the account is served again (minutes); 0: nothing. */
  regainMinutes: number
  readAt: Date
}

const waitOf = (minutes: number) =>
  Math.min(SLOW_DOWN_MAX_MINUTES, Math.max(SLOW_DOWN_DEFAULT_MINUTES, Math.ceil(minutes)))

const plus = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE_MS)

/**
 * When the step may run, or null when it may now. `account`: the last reading of the
 * destination's account; `agency`: the last reading of any account of the agency, for the app's
 * usage.
 */
export function slowDownUntil(
  step: 'prepare' | 'publish',
  readings: { account: UsageReading | null; agency: UsageReading | null },
  now: Date,
): Date | null {
  const above = step === 'publish' ? SLOW_DOWN_PUBLISH_ABOVE_PERCENT : SLOW_DOWN_ABOVE_PERCENT
  const until: Date[] = []
  const { account, agency } = readings
  if (account?.accountPercent != null && account.accountPercent > above)
    until.push(plus(account.readAt, waitOf(account.regainMinutes)))
  for (const r of [account, agency])
    if (r?.appPercent != null && r.appPercent > above)
      until.push(plus(r.readAt, SLOW_DOWN_DEFAULT_MINUTES))
  const latest = until.reduce<Date | null>((a, b) => (a === null || b > a ? b : a), null)
  return latest !== null && latest.getTime() > now.getTime() ? latest : null
}
