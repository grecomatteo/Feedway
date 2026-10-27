import { sendAccountLockedNotice, sendAccountLockedNoticeEmail } from '@app/application'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'

const noticeDeps = (deps: JobHandlerDeps) => ({
  uow: deps.uow,
  queue: deps.queue,
  mailer: deps.mailer,
  translate: deps.translate,
  logger: deps.logger,
  panelUrl: deps.panel.url,
  productName: deps.panel.productName,
  defaultTimezone: deps.panel.defaultTimezone,
})

export const identityAccountLockedNotice: JobHandler<'identity.account_locked_notice'> = (
  job,
  deps,
) => sendAccountLockedNotice(noticeDeps(deps), job.data)

export const identityAccountLockedNoticeEmail: JobHandler<
  'identity.account_locked_notice_email'
> = (job, deps) => sendAccountLockedNoticeEmail(noticeDeps(deps), job.data)
