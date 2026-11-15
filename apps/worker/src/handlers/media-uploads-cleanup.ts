import { runMediaUploadsCleanup } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `media.uploads_cleanup` (plan 04 Task 9), every hour: the work is in the media module.

export const mediaUploadsCleanup: JobHandler<'media.uploads_cleanup'> = async (_job, deps) => {
  await runMediaUploadsCleanup({
    uow: deps.uow,
    clock: deps.clock,
    queue: deps.queue,
    uploadParts: deps.uploadParts,
    logger: deps.logger,
  })
}
