import {
  createEmailChannel,
  createTelegramChannel,
  createTelegramTargets,
  pollTelegram,
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
    channels: [
      createEmailChannel({
        mailer: deps.mailer,
        t,
        productName: deps.panel.productName,
        panelUrl: deps.panel.url,
      }),
      createTelegramChannel({
        t,
        telegram: deps.telegram.api,
        targets: createTelegramTargets({ uow: deps.uow, integrations: deps.telegram.integrations }),
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

/** Telegram's long poll: under a minute, so the next run of the schedule finds the lock free. */
export const TELEGRAM_POLL_WAIT_SECONDS = 50

export const telegramPoll: JobHandler<'telegram.poll'> = async (job, deps) => {
  const report = await pollTelegram(
    {
      uow: deps.uow,
      clock: deps.clock,
      logger: deps.logger,
      t: deps.translate,
      panelUrl: deps.panel.url,
      integrations: deps.telegram.integrations,
      telegram: deps.telegram.api,
      tokens: deps.telegram.tokens,
      lock: deps.telegram.lock,
      waitSeconds: deps.telegram.waitSeconds ?? TELEGRAM_POLL_WAIT_SECONDS,
    },
    job.signal,
  )
  if (report.updates > 0 || report.cleaned > 0)
    deps.logger.info({ jobId: job.id, ...report }, 'telegram polled')
}
