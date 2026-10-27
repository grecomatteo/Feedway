import { sendAccountRecoveryEmail } from '@app/application'
import type { JobHandler } from '../job-handler.js'

export const identityAccountRecoveryEmail: JobHandler<'identity.account_recovery_email'> = (
  job,
  deps,
) =>
  sendAccountRecoveryEmail(
    {
      uow: deps.uow,
      mailer: deps.mailer,
      translate: deps.translate,
      logger: deps.logger,
      clock: deps.clock,
      panelUrl: deps.panel.url,
      productName: deps.panel.productName,
      defaultTimezone: deps.panel.defaultTimezone,
    },
    job.data,
  )
