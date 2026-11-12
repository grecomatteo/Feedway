import { runAccountsDaily } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `accounts.daily` (§8.4, plan 03 Task 11): the work is in the accounts module.

export const accountsDaily: JobHandler<'accounts.daily'> = async (_job, deps) => {
  await runAccountsDaily({
    uow: deps.uow,
    clock: deps.clock,
    queue: deps.queue,
    logger: deps.logger,
  })
}
