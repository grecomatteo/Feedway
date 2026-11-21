import { CANCELLED_IN_PANEL_KEY } from '@app/domain'
import type { PublishingTargetRecord } from '../../ports/publishing.js'

// What a round of the worker notes in `post_targets.verification` before anything is published,
// until the next round writes it:
// - «Riprova» from `failed` starts the destination again at once (plan 07, Scelta 1): the 15
//   minutes of D-77 (b) count from the «Riprova», not from the post's time, which stays for the
//   history; after `uncertain_not_found` the platform decides what of the old round is kept
//   (`idsAfterNotFound`, review R2).
// - A preparation that started in time and waits for Feedway's own files, its turn or Meta's
//   load stays `scheduled`: it is not a late start (review R8), only the 60 minutes of
//   `isPastLatestStart` still hold.

type Verification = Pick<PublishingTargetRecord, 'verification'>

const fieldsOf = (target: Verification): Record<string, unknown> => {
  const v = target.verification
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

const dateOf = (raw: unknown): Date | null => {
  const at = typeof raw === 'string' ? new Date(raw) : null
  return at && Number.isFinite(at.getTime()) ? at : null
}

export const retryMark = (at: Date, afterNotFound = false) => ({
  retriedAt: at.toISOString(),
  ...(afterNotFound ? { afterNotFound: true } : {}),
})

/** A person's «Annulla»: a save of the post on its way leaves the account out (review M1). */
export const CANCELLED_IN_PANEL = { [CANCELLED_IN_PANEL_KEY]: true }

export const retriedAtOf = (target: Verification): Date | null =>
  dateOf(fieldsOf(target)['retriedAt'])

/** The «Riprova» came after an uncertain call never found on the account. */
export const retriedAfterNotFound = (target: Verification): boolean =>
  fieldsOf(target)['afterNotFound'] === true

/** When the preparation started in time, if it is waiting since then. */
export const preparingSinceOf = (target: Verification): Date | null =>
  dateOf(fieldsOf(target)['preparingSince'])

/** The notes with the start of a preparation that waits; the first start stays. */
export const withPreparingSince = (target: Verification, at: Date): Record<string, unknown> => {
  const fields = fieldsOf(target)
  return preparingSinceOf(target) === null
    ? { ...fields, preparingSince: at.toISOString() }
    : fields
}
