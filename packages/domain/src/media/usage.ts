import type { PostStatus } from '../posts/post.js'

// Which post a file of the library is «in» (spec §11.8, D-18; D-80.7). The library shows one use
// per file, and that use must not depend on the order the rows come in, nor on the filter: the
// order is decided here, once, and the repository sorts in SQL by the same criterion.

/** A post that uses a file, as a file or as a reel's cover. */
export interface MediaUse {
  postId: string
  status: PostStatus
  scheduledAt: Date | null
  /** the post's own (D-58), for the day the panel names */
  timezone: string
  updatedAt: Date
}

const RANK: Readonly<Record<PostStatus, number>> = { scheduled: 0, draft: 1, cancelled: 2 }

/**
 * A total order on the uses of a file: scheduled first, the nearest date first (a scheduled post
 * without a date after the dated ones); then drafts, the one changed last first; then cancelled
 * posts, the same way; on a tie, the post id.
 */
export function compareUses(a: MediaUse, b: MediaUse): number {
  const rank = RANK[a.status] - RANK[b.status]
  if (rank !== 0) return rank
  if (a.status === 'scheduled') {
    const at = compareDates(a.scheduledAt, b.scheduledAt)
    if (at !== 0) return at
  } else {
    const at = b.updatedAt.getTime() - a.updatedAt.getTime()
    if (at !== 0) return at
  }
  return a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0
}

/** Earlier first, null last. */
function compareDates(a: Date | null, b: Date | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return a.getTime() - b.getTime()
}

/** The use the library names for a file («Nel post di …», «In una bozza»), or null. */
export function primaryUse<T extends MediaUse>(uses: readonly T[]): T | null {
  let first: T | null = null
  for (const use of uses) if (first === null || compareUses(use, first) < 0) first = use
  return first
}

/** How many posts use a file: a post that uses it twice (file and cover) counts once. */
export function postCount(uses: readonly Pick<MediaUse, 'postId'>[]): number {
  return new Set(uses.map((u) => u.postId)).size
}
