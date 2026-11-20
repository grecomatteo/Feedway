import type { PlatformPublishers } from '@app/application'
import { createInstagramPublisher } from './instagram-publish.js'
import type { MetaPublisherDeps } from './publish-support.js'

// `PlatformPublisher` for Meta (ADR 019, plan 07 Task 4): one per platform, on the same client.

export type { MetaPublisherDeps } from './publish-support.js'

export function createMetaPublishers(deps: MetaPublisherDeps): PlatformPublishers {
  // Facebook joins with Task 5
  return { instagram: createInstagramPublisher(deps) }
}
