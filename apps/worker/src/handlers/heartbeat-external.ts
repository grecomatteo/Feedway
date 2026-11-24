import { pingExternalWatch } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `heartbeat.external` (§16.7, plan 08 Task 9): every minute, the call to healthchecks.io.

export const heartbeatExternal: JobHandler<'heartbeat.external'> = async (job, deps) => {
  const report = await pingExternalWatch({
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    integrations: deps.externalWatch.integrations,
    pinger: deps.externalWatch.pinger,
    lock: deps.media.lock,
  })
  if (report.outcome === 'called' && !report.result.ok)
    deps.logger.info({ jobId: job.id, problem: report.result.problem }, 'external watch called')
}
