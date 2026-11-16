import { markMediaQueued } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `media.process` (ADR 021): the queue is fed from plan 04 Task 9; until Task 10 brings the
// processing, the file only shows it is waiting.

export const mediaProcess: JobHandler<'media.process'> = async (job, deps) => {
  const result = await markMediaQueued({ uow: deps.uow }, job.data)
  deps.logger.info({ mediaId: job.data.mediaId, ...result }, 'media waiting for processing')
}
