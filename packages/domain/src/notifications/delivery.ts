// The attempts of one delivery (plan 08, «Ogni invio in transazione corta»).

/** Minutes before each new try: after the first failure 1, then 5, then 15. */
const RETRY_MINUTES = [1, 5, 15] as const

/** The first send and its three retries; after them the delivery is `failed`. */
export const DELIVERY_ATTEMPTS = RETRY_MINUTES.length + 1

/**
 * How long a group stays `sending` (`claimed_until`). Longer than any send, with its timeout:
 * past it the dispatcher's sweep sends the job again, so a process that fell between the send
 * and the save repeats one send at most (P2).
 */
export const CLAIM_MS = 5 * 60_000

/**
 * `attempts` is how many sends failed before this one. null: no more tries, the delivery has
 * failed.
 */
export function afterFailure(attempts: number, at: Date): { retryAt: Date | null } {
  const minutes = RETRY_MINUTES[attempts]
  return { retryAt: minutes === undefined ? null : new Date(at.getTime() + minutes * 60_000) }
}
