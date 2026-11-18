import type { PublishingHistory } from '@app/application'

/** Nothing published or scheduled: for the tests of the rules that need no history. */
export const emptyPublishingHistory: PublishingHistory = {
  forDestinations: () =>
    Promise.resolve({
      recentFingerprints: new Map(),
      reelsLast24h: new Map(),
      scheduledNear: new Map(),
    }),
}

/**
 * The scheduled destinations of the agency (plan 06 Task 3), read in the caller's transaction.
 * Stage 7 adds the published ones.
 */
export const postgresPublishingHistory: PublishingHistory = {
  forDestinations: (tx, query) => tx.posts.publishingFacts(query),
}
