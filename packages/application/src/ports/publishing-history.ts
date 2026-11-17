import type { PublishingHistoryFacts } from '@app/domain'
import type { Tx } from './tx.js'

/**
 * What is already published or scheduled on some accounts (plan 05 R4): the fingerprints of
 * the last 7 days' posts and the counts in the 24 hours around `at`. Until stages 6–7 there
 * are no posts, and the implementation answers with none.
 */
export interface PublishingHistory {
  forDestinations(
    tx: Tx,
    query: { organizationId: string; accountIds: readonly string[]; at: Date },
  ): Promise<PublishingHistoryFacts>
}
