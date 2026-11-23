import {
  createEmailChannel,
  notificationKinds,
  watchWorker,
  type WorkerWatchDeps,
} from '@app/application'
import { PRODUCT_NAME } from '@app/config'
import { createAdvisoryLock } from '@app/infrastructure'
import type { Deps } from './deps'

const KINDS = notificationKinds()

/**
 * What the web's watch over the worker needs (plan 08 Scelta 10): the same deliveries as the
 * worker's `notify.deliver_platform`, sent from here because the worker is the one that stopped.
 */
export function workerWatchDeps(deps: Deps): WorkerWatchDeps {
  const t = deps.translate
  return {
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger.child({ component: 'worker-watch' }),
    t,
    panelUrl: deps.config.panelUrl,
    defaultTimezone: deps.config.defaultTimezone,
    kinds: KINDS,
    // the platform's Telegram bot joins with its channel (plan 08 Task 7)
    channels: [
      createEmailChannel({
        mailer: deps.mailer,
        t,
        productName: PRODUCT_NAME,
        panelUrl: deps.config.panelUrl,
      }),
    ],
    lock: createAdvisoryLock(deps.pool),
  }
}

/** Every minute, one web at a time (the lock); a run still going skips the next tick. */
export function startWorkerWatch(deps: Deps, everyMs = 60_000): () => void {
  const watchDeps = workerWatchDeps(deps)
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    watchWorker(watchDeps)
      .catch((error: unknown) => {
        watchDeps.logger.error({ err: error }, 'worker watch failed')
      })
      .finally(() => {
        running = false
      })
  }, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}
