import {
  createEmailChannel,
  deliverNotification,
  deliverPlatformNotification,
  dispatchNotifications,
  notificationKinds,
  type DispatchDeps,
} from '@app/application'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'

// The notifications' jobs (plan 08 Task 5): the dispatcher of the outbox and the deliveries.

const KINDS = notificationKinds()

export function notifyDeps(deps: JobHandlerDeps): DispatchDeps {
  const t = deps.translate
  return {
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    queue: deps.queue,
    t,
    panelUrl: deps.panel.url,
    defaultTimezone: deps.panel.defaultTimezone,
    kinds: KINDS,
    // Telegram joins with Task 7
    channels: [
      createEmailChannel({
        mailer: deps.mailer,
        t,
        productName: deps.panel.productName,
        panelUrl: deps.panel.url,
      }),
    ],
  }
}

export const notifyDispatch: JobHandler<'notify.dispatch'> = async (job, deps) => {
  const report = await dispatchNotifications(notifyDeps(deps))
  if (report.events > 0 || report.jobs > 0)
    deps.logger.info({ jobId: job.id, ...report }, 'notifications dispatched')
}

export const notifyDeliver: JobHandler<'notify.deliver'> = async (job, deps) => {
  const report = await deliverNotification(notifyDeps(deps), job.data, job.signal)
  if (report.outcome !== 'nothing')
    deps.logger.info({ jobId: job.id, ...report }, 'notification delivered')
}

export const notifyDeliverPlatform: JobHandler<'notify.deliver_platform'> = async (job, deps) => {
  const report = await deliverPlatformNotification(notifyDeps(deps), job.data, job.signal)
  if (report.outcome !== 'nothing')
    deps.logger.info({ jobId: job.id, ...report }, 'platform notification delivered')
}
