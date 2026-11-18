import type { PostStatus } from './post.js'

// The moves of a post in stage 6 (plan 06, P7). A draft is deleted, never cancelled; a
// scheduled post goes back to draft («Riporta in bozza») or is cancelled. Every other move is
// refused. The full machine of §9.3 stays in `publishing` (stage 7).

const ALLOWED: ReadonlyMap<PostStatus, readonly PostStatus[]> = new Map([
  ['draft', ['scheduled']],
  ['scheduled', ['draft', 'cancelled']],
  ['cancelled', []],
])

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return ALLOWED.get(from)?.includes(to) ?? false
}

/**
 * The state of a post from its destinations (§9.3): one scheduled destination makes the post
 * scheduled, all of them cancelled make it cancelled; anything else, no destination included,
 * is a draft.
 */
export function postStatusOf(targets: readonly PostStatus[]): PostStatus {
  if (targets.includes('scheduled')) return 'scheduled'
  if (targets.length > 0 && targets.every((s) => s === 'cancelled')) return 'cancelled'
  return 'draft'
}
