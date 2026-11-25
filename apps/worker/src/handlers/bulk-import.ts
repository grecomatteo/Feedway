import { runBulkImport } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `bulk.import` (plan 09 P5): the rows of one import, one per transaction, in the agency and as
// the person who started it; the publishing's jobs of each row are sent after its commit.
export const bulkImport: JobHandler<'bulk.import'> = async (job, deps) => {
  const report = await runBulkImport(
    {
      uow: deps.uow,
      clock: deps.clock,
      queue: deps.queue,
      logger: deps.logger,
      ids: deps.ids,
      newPublicToken: deps.media.newPublicToken,
      platformRules: deps.publishing.platformRules,
      publishingHistory: deps.publishing.publishingHistory,
    },
    job.data,
  )
  deps.logger.info(
    { jobId: job.id, bulkImportId: job.data.bulkImportId, ...report },
    'bulk import run done',
  )
}
