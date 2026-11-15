import { deleteMediaFiles } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `media.delete_files` (plan 04 Task 8): the work is in the media module.

export const mediaDeleteFiles: JobHandler<'media.delete_files'> = async (job, deps) => {
  const result = await deleteMediaFiles({ uow: deps.uow, storage: deps.storage }, job.data)
  deps.logger.info({ mediaId: job.data.mediaId, ...result }, 'media files')
}
