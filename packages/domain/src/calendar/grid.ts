import type { TargetStatus } from '../publishing/target-status.js'
import type { PostType } from '../rules/types.js'

// Instagram's grid (spec §11.5, plan 09 Task 12, Scelta 10): one Instagram account at a time,
// its scheduled posts of the next days above the last ones out. Only the scheduled ones change
// place, by swapping their times: Instagram does not move what is out.

/** The scheduled posts of these next days come before the ones out. */
export const GRID_DAYS_AHEAD = 30
/** The posts out read from the platform: the last ones, newest first. */
export const GRID_PUBLISHED_LIMIT = 30
/** What reaches the grid; a story never does. */
export const GRID_POST_TYPES: readonly PostType[] = ['photo', 'carousel', 'reel']

/** A reel shown only among the reels (`shareToFeed` off) is not in the grid either. */
export const isGridPost = (post: { type: PostType; shareToFeed: boolean }) =>
  GRID_POST_TYPES.includes(post.type) && (post.type !== 'reel' || post.shareToFeed)

/** A media id of the platform as the grid takes it in an address: digits only. */
export const isGridMediaId = (value: string) => /^[0-9]{1,32}$/.test(value)

/**
 * A destination still to go out on the account: its post is in the grid as scheduled. One
 * already out is among the posts read from the platform; a cancelled or failed one is in none.
 */
const WAITING: ReadonlySet<TargetStatus> = new Set([
  'scheduled',
  'preparing',
  'ready',
  'publishing',
  'retrying',
  'paused',
])
export const isGridWaiting = (status: TargetStatus) => WAITING.has(status)
