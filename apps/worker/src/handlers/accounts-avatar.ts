import { refreshAccountAvatar } from '@app/application'
import type { JobHandler } from '../job-handler.js'

// `accounts.avatar` (plan 04 Task 4): the work is in the accounts module.

export const accountsAvatar: JobHandler<'accounts.avatar'> = async (job, deps) => {
  const result = await refreshAccountAvatar(
    {
      uow: deps.uow,
      storage: deps.storage,
      images: deps.images,
      connectors: deps.connectors,
      logger: deps.logger,
    },
    job.data,
  )
  deps.logger.info({ accountId: job.data.accountId, ...result }, 'account picture')
}
