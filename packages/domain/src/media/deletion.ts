import { postCount, primaryUse, type MediaUse } from './usage.js'

// When a file of the library is not deleted (D-18, D-80.4). The use case refuses with 409 and
// the panel reads the same answer in the file's DTO, so «Elimina» is off, with the reason,
// before anyone tries.

export interface DeletionBlock {
  reason: 'in_scheduled_post'
  /** the nearest scheduled post that uses the file */
  postId: string
  scheduledAt: Date | null
  timezone: string
  /** how many scheduled posts use the file */
  count: number
}

/** Why the file of these uses is not deleted, or null when it is. */
export function deletionBlock(uses: readonly MediaUse[]): DeletionBlock | null {
  const scheduled = uses.filter((u) => u.status === 'scheduled')
  const first = primaryUse(scheduled)
  if (first === null) return null
  return {
    reason: 'in_scheduled_post',
    postId: first.postId,
    scheduledAt: first.scheduledAt,
    timezone: first.timezone,
    count: postCount(scheduled),
  }
}
