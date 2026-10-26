import { sendPasswordResetEmail } from '@app/application'
import type { JobHandler } from '../job-handler.js'

export const identityPasswordResetEmail: JobHandler<'identity.password_reset_email'> = (
  job,
  deps,
) =>
  sendPasswordResetEmail(
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
