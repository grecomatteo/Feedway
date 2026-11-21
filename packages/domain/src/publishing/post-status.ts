import type { TargetStatus } from './target-status.js'

/**
 * The states of a post with publishing (plan 07, Scelta 3). `partial` is «N non uscito»;
 * «In verifica» is not a state of the post, only of a destination on the outcome page.
 */
export const PUBLISHING_POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'partial',
  'failed',
  'problem',
  'published',
  'paused',
  'cancelled',
] as const
export type PublishingPostStatus = (typeof PUBLISHING_POST_STATUSES)[number]

const ON_ITS_WAY = new Set<TargetStatus>([
  'preparing',
  'ready',
  'publishing',
  'retrying',
  'unknown',
])
const OUT = new Set<TargetStatus>(['published', 'verifying', 'confirmed'])

/**
 * The state of a post from its destinations, in the order of Scelta 3, without the cancelled
 * ones: a failure is never hidden behind «Programmato». A destination scheduled again («Riprova»)
 * next to one that ended makes the post «In pubblicazione»: part of it is out or did not go out,
 * so it is no longer a post the panel edits as a scheduled one.
 */
export function postStatusFromTargets(targets: readonly TargetStatus[]): PublishingPostStatus {
  const live = targets.filter((s) => s !== 'cancelled')
  if (live.length === 0) return targets.length > 0 ? 'cancelled' : 'draft'
  if (live.includes('paused')) return 'paused'
  if (live.some((s) => ON_ITS_WAY.has(s))) return 'publishing'
  if (live.includes('scheduled') && live.some((s) => s !== 'scheduled' && s !== 'draft'))
    return 'publishing'
  if (live.includes('failed')) return live.every((s) => s === 'failed') ? 'failed' : 'partial'
  if (live.includes('problem')) return 'problem'
  if (live.every((s) => OUT.has(s))) return 'published'
  return live.includes('scheduled') ? 'scheduled' : 'draft'
}
