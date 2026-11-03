import { runRetention, sendAnonymizationNotice, userAnonymizedHandlers } from '@app/application'
import type { JobHandler } from '../job-handler.js'

export const identityRetention: JobHandler<'identity.retention'> = async (_job, deps) => {
  await runRetention({
    uow: deps.uow,
    clock: deps.clock,
    storage: deps.storage,
    logger: deps.logger,
    queue: deps.queue,
    auth: deps.credentials,
    onUserAnonymized: userAnonymizedHandlers(),
  })
}

export const identityAnonymizationNotice: JobHandler<'identity.anonymization_notice'> = (
  job,
  deps,
) =>
  sendAnonymizationNotice(
    {
      uow: deps.uow,
      mailer: deps.mailer,
      translate: deps.translate,
      logger: deps.logger,
      panelUrl: deps.panel.url,
      productName: deps.panel.productName,
      defaultTimezone: deps.panel.defaultTimezone,
    },
    job.data,
  )
