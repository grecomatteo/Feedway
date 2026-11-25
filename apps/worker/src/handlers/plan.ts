import { scanPlanDue } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `plan.due_scan` (plan 09 P3): every 5 minutes, «da preparare, mancano meno di 36 ore» for the contents
// whose time has come; the dispatcher of stage 8 does the rest.
export const planDueScan: JobHandler<'plan.due_scan'> = async (job, deps) => {
  const report = await scanPlanDue({
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    // the installation's advisory lock (ADR 021), shared with the media's and the digests'
    lock: deps.media.lock,
  })
  if (report.told > 0) deps.logger.info({ jobId: job.id, ...report }, 'plan contents told')
}
