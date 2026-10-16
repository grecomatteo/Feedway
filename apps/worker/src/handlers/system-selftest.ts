import type { Logger } from '@app/application'

export function systemSelftest(logger: Logger) {
  return (job: { id: string }): Promise<void> => {
    logger.info({ jobId: job.id }, 'system.selftest handled')
    return Promise.resolve()
  }
}
