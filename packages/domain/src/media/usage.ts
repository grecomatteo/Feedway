import type { PublishingPostStatus } from '../publishing/post-status.js'

// Which post a file of the library is «in» (spec §11.8, D-18; D-80.7). The library shows one use
// per file, and that use must not depend on the order the rows come in, nor on the filter: the
// order is decided here, once, and the repository sorts in SQL by the same criterion.

/** A post that uses a file, as a file or as a reel's cover. */
export interface MediaUse {
  postId: string
  status: PublishingPostStatus
  scheduledAt: Date | null
  /** the post's own (D-58), for the day the panel names */
  timezone: string
  updatedAt: Date
}

/**
 * The groups of the uses, in order: still going out (scheduled, on its way, paused), drafts, gone
 * out (all or in part, or out with a problem: «Pubblicato il …», plan 07 Scelta 5), the rest (not
 * out, cancelled).
 */
export const USE_RANK: Readonly<Record<PublishingPostStatus, number>> = {
  scheduled: 0,
  publishing: 0,
  paused: 0,
  draft: 1,
  published: 2,
  partial: 2,
  problem: 2,
  failed: 3,
  cancelled: 3,
}

/** A post that will still go out without anyone's hand: its files stay (D-18). */
export const isGoingOut = (status: PublishingPostStatus) => USE_RANK[status] === 0

/**
 * A total order on the uses of a file: going out first, the nearest date first (a scheduled post
 * without a date after the dated ones); then drafts, the one changed last first; then the posts
 * gone out, the latest date first (one without a date last); then the rest, the one changed last first; on a tie, the post
 * id.
 */
export function compareUses(a: MediaUse, b: MediaUse): number {
  const rank = USE_RANK[a.status] - USE_RANK[b.status]
  if (rank !== 0) return rank
  const at =
    USE_RANK[a.status] === 0
      ? compareDates(a.scheduledAt, b.scheduledAt)
      : USE_RANK[a.status] === 2
        ? latestFirst(a.scheduledAt, b.scheduledAt)
        : b.updatedAt.getTime() - a.updatedAt.getTime()
  if (at !== 0) return at
  return a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0
}

/** Later first, null last. */
function latestFirst(a: Date | null, b: Date | null): number {
  if (a === null || b === null) return compareDates(a, b)
  return b.getTime() - a.getTime()
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
