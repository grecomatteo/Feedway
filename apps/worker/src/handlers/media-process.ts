import { processNextMedia } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `media.process` (ADR 021): a wake-up. One conversion at a time for the installation, the
// next file at its agency's turn (plan 04 Task 10).

export const mediaProcess: JobHandler<'media.process'> = async (job, deps) => {
  const result = await processNextMedia(
    {
      ...deps.media,
      uow: deps.uow,
      clock: deps.clock,
      ids: deps.ids,
      storage: deps.storage,
      queue: deps.queue,
      logger: deps.logger,
    },
    { ...job.data, jobId: job.id, signal: job.signal },
  )
  deps.logger.info({ jobId: job.id, ...result }, 'media process wake-up done')
}
