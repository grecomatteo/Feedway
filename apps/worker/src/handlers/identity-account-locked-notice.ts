import { sendAccountLockedNotice } from '@app/application'
import type { JobHandler } from '../job-handler.js'

export const identityAccountLockedNotice: JobHandler<'identity.account_locked_notice'> = (
  job,
  deps,
) =>
  sendAccountLockedNotice(
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
