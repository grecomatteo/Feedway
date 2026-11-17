import type { PublishingHistory } from '@app/application'

/**
 * No post is published or scheduled yet (plan 05 R4): the tables of the posts arrive with
 * stages 6–7, which replace this with a reading of `post_targets`.
 */
export const emptyPublishingHistory: PublishingHistory = {
  forDestinations: () =>
    Promise.resolve({
      recentFingerprints: new Map(),
      reelsLast24h: new Map(),
      scheduledNear: new Map(),
    }),
}
