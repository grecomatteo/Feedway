import { isGoingOut, postCount, primaryUse, type MediaUse } from './usage.js'
import type { PublishingPostStatus } from '../publishing/post-status.js'

// When a file of the library is not deleted (D-18, D-80.4). The use case refuses with 409 and
// the panel reads the same answer in the file's DTO, so «Elimina» is off, with the reason,
// before anyone tries.

/** Why: the state of the nearest post that keeps the file (review R10, R11). */
export type DeletionBlockReason =
  'in_scheduled_post' | 'in_publishing_post' | 'in_paused_post' | 'in_failed_post'

export interface DeletionBlock {
  reason: DeletionBlockReason
  /** the nearest post that keeps the file */
  postId: string
  scheduledAt: Date | null
  timezone: string
  /** how many posts keep the file */
  count: number
}

/**
 * A post that still needs its files: going out without anyone's hand, or not out on one account
 * where «Riprova» would publish it (R11: the copies of a deleted file would go out).
 */
const keepsFiles = (status: PublishingPostStatus) =>
  isGoingOut(status) || status === 'failed' || status === 'partial'

const REASON: Partial<Record<PublishingPostStatus, DeletionBlockReason>> = {
  scheduled: 'in_scheduled_post',
  publishing: 'in_publishing_post',
  paused: 'in_paused_post',
}

/** Why the file of these uses is not deleted, or null when it is. */
export function deletionBlock(uses: readonly MediaUse[]): DeletionBlock | null {
  const keeping = uses.filter((u) => keepsFiles(u.status))
  const first = primaryUse(keeping)
  if (first === null) return null
  return {
    reason: REASON[first.status] ?? 'in_failed_post',
    postId: first.postId,
    scheduledAt: first.scheduledAt,
    timezone: first.timezone,
    count: postCount(keeping),
  }
}
