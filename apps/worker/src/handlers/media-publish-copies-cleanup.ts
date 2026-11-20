import { cleanupPublishCopies, publishCopiesInUse } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `media.publish_copies_cleanup` (plan 07 Scelta 5), every night: the work is in the media
// module; which copies the posts still need is the posts module's to say.

export const mediaPublishCopiesCleanup: JobHandler<'media.publish_copies_cleanup'> = async (
  job,
  deps,
) => {
  const report = await cleanupPublishCopies({
    uow: deps.uow,
    clock: deps.clock,
    storage: deps.storage,
    logger: deps.logger,
    retentionDays: deps.publishing.copiesKeptDays,
    copiesInUse: (tx, organizationId, endedAfter) =>
      publishCopiesInUse(
        tx,
        {
          clock: deps.clock,
          logger: deps.logger,
          platformRules: deps.publishing.platformRules,
          publishingHistory: deps.publishing.publishingHistory,
        },
        organizationId,
        endedAfter,
      ),
  })
  if (report.removed > 0)
    deps.logger.info({ jobId: job.id, ...report }, 'publish copies cleaned up')
}
