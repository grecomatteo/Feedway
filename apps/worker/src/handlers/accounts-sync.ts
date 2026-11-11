import { syncConnection, type AccountJobsDeps } from '@app/application'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'

// `accounts.sync` (§8.4, plan 03 Task 10): the work is in the accounts module.

export const jobsDeps = (deps: JobHandlerDeps): AccountJobsDeps => ({
  uow: deps.uow,
  clock: deps.clock,
  tokens: deps.connectionTokens,
  connectors: deps.connectors,
  queue: deps.queue,
  logger: deps.logger,
})

export const accountsSync: JobHandler<'accounts.sync'> = async (job, deps) => {
  const result = await syncConnection(jobsDeps(deps), job.data)
  deps.logger.info({ connectionId: job.data.connectionId, ...result }, 'accounts synced')
}
