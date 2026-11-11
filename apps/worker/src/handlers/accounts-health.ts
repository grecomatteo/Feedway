import { checkConnectionHealth } from '@app/application'
import type { JobHandler } from '../job-handler.js'
import { jobsDeps } from './accounts-sync.js'

// `accounts.health` (§8.4, plan 03 Task 10): the work is in the accounts module.

export const accountsHealth: JobHandler<'accounts.health'> = async (job, deps) => {
  const result = await checkConnectionHealth(jobsDeps(deps), job.data)
  deps.logger.info({ connectionId: job.data.connectionId, ...result }, 'accounts checked')
}
