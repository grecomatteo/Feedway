import type { JobHandler } from '../job-handler.js'

export const systemSelftest: JobHandler<'system.selftest'> = (job, { logger }) => {
  logger.info({ jobId: job.id }, 'system.selftest handled')
  return Promise.resolve()
}
