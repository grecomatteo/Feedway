import type { PublishingHistoryFacts } from '@app/domain'
import type { PublishingHistoryQuery } from './posts.js'
import type { Tx } from './tx.js'

export type { PublishingHistoryQuery } from './posts.js'

/**
 * What is already scheduled on some accounts (plan 05 R4, plan 06 Task 3): the fingerprints of
 * the posts within 7 days of `at`, and the counts in the 24 hours before it. `excludePostId`:
 * the post being checked, never a duplicate of itself. From stage 7 it counts the published
 * posts too.
 */
export interface PublishingHistory {
  forDestinations(tx: Tx, query: PublishingHistoryQuery): Promise<PublishingHistoryFacts>
}
