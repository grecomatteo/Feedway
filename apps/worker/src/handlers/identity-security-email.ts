import { sendSecurityEmail } from '@app/application'
import type { JobHandler } from '../job-handler.js'

export const identitySecurityEmail: JobHandler<'identity.security_email'> = (job, deps) =>
  sendSecurityEmail(
    {
      uow: deps.uow,
      mailer: deps.mailer,
      tokens: deps.signedTokens,
      clock: deps.clock,
      translate: deps.translate,
      logger: deps.logger,
      panelUrl: deps.panel.url,
      productName: deps.panel.productName,
      defaultTimezone: deps.panel.defaultTimezone,
    },
    job.data,
  )
