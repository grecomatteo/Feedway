import { cleanupDrafts } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `posts.drafts_cleanup` (plan 09 Task 14), every night: «Eliminati» older than 30 days and the
// empty drafts go for good, the drafts nobody touches go to «Eliminati».
export const postsDraftsCleanup: JobHandler<'posts.drafts_cleanup'> = async (job, deps) => {
  const report = await cleanupDrafts({
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    // the installation's advisory lock (ADR 021), shared with the plan's scan
    lock: deps.media.lock,
  })
  if (report.deleted > 0 || report.trashed > 0)
    deps.logger.info({ jobId: job.id, ...report }, 'drafts cleaned up')
}
