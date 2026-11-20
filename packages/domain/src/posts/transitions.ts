import { canMoveTarget } from '../publishing/transitions.js'
import { postStatusFromTargets } from '../publishing/post-status.js'
import type { PostStatus } from './post.js'

// The moves of a post that the panel saves today (plan 06, P7): draft, scheduled, cancelled.
// They are the panel's moves of the full machine of §9.3 (`publishing`, plan 07 Task 2) seen
// from these three states. The tables take every state since plan 07 Task 3; the panel reads
// the new ones when Task 7 and Task 9 show them (D-100.15).

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return canMoveTarget(from, to, 'panel')
}

/**
 * The state of a post from its destinations (§9.3, plan 07 Scelta 3): one scheduled
 * destination makes the post scheduled, all of them cancelled make it cancelled; anything
 * else, no destination included, is a draft.
 */
export function postStatusOf(targets: readonly PostStatus[]): PostStatus {
  const status = postStatusFromTargets(targets)
  // with draft, scheduled and cancelled destinations only, the post is one of them too
  if (status === 'draft' || status === 'scheduled' || status === 'cancelled') return status
  throw new Error(`unexpected post status ${status}`)
}
