import {
  callExternalWatch,
  createEmailChannel,
  createTelegramChannel,
  createTelegramTargets,
  notificationKinds,
  watchWorker,
  type WorkerWatchDeps,
} from '@app/application'
import { PRODUCT_NAME } from '@app/config'
import { createAdvisoryLock } from '@app/infrastructure'
import type { Deps } from './deps.js'
import { everyMinute } from './every-minute.js'
import { monitoringDeps } from './monitoring.js'

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
    // as the worker's `notifyDeps`: email and the Telegram bot
    channels: [
      createEmailChannel({
        mailer: deps.mailer,
        t,
        productName: PRODUCT_NAME,
        panelUrl: deps.config.panelUrl,
      }),
      createTelegramChannel({
        t,
        telegram: deps.telegram,
        targets: createTelegramTargets({ uow: deps.uow, integrations: deps.integrations }),
      }),
    ],
    lock: createAdvisoryLock(deps.pool),
  }
}

/**
 * The web's rounds over the platform (§16.7): the watch over the worker (one web at a time, the
 * lock) and the call to healthchecks.io (R4 of the tappa 8 review). The call comes from the web
 * because the web serves the panel and `/m/*` to Meta: when it stops, or the database or the
 * VPS does, nobody calls and the external watch raises its alarm; a worker that stops is told
 * by the watch above. No lock for the call: each web calls, and a second call in the same
 * minute changes nothing for healthchecks.io, while a lock would hold a connection of the pool
 * for the whole wait of the network.
 */
export function startPlatformWatch(deps: Deps, everyMs = 60_000): () => void {
  const watchDeps = workerWatchDeps(deps)
  const external = {
    ...monitoringDeps(deps),
    logger: deps.logger.child({ component: 'external-watch' }),
  }
  return everyMinute(
    [
      { name: 'worker-watch', run: () => watchWorker(watchDeps) },
      { name: 'external-watch', run: () => callExternalWatch(external) },
    ],
    deps.logger.child({ component: 'platform-watch' }),
    everyMs,
  )
}
