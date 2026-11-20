import { makeNextPublishCopy } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `media.publish_copies` (plan 07 Task 6): a wake-up, as `media.process`. The next copy to
// publish at its agency's turn, under the same lock as the conversions of the files.

export const mediaPublishCopies: JobHandler<'media.publish_copies'> = async (job, deps) => {
  const result = await makeNextPublishCopy(
    {
      ...deps.media,
      uow: deps.uow,
      clock: deps.clock,
      storage: deps.storage,
      queue: deps.queue,
      logger: deps.logger,
    },
    { ...job.data, jobId: job.id, signal: job.signal },
  )
  deps.logger.info({ jobId: job.id, ...result }, 'publish copies wake-up done')
}
