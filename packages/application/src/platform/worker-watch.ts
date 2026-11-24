import {
  DELIVERY_ATTEMPTS,
  HEARTBEAT_RETIRED_MS,
  beatHealth,
  workerSilent,
  type BeatHealth,
} from '@app/domain'
import { deliverGroup, notificationsOf, type DeliverDeps } from '../notifications/index.js'
import type { HeartbeatDetails, HeartbeatRecord } from '../ports/heartbeats.js'
import type { ExclusiveLock } from '../ports/media-processing.js'
import type { DeliveryRef } from '../ports/notifications.js'
import type { Clock } from '../ports/clock.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// The worker's beat (§16.7, plan 08 P5) and the web's watch over it (Scelta 10). Each worker
// writes its row of `system_heartbeats` every 30 seconds. Every minute one web (the lock) looks
// at the rows: with no worker beating for 2 minutes it writes `system.worker_down` and sends it
// itself, because the worker that would send it is the one that stopped; when a beat comes back,
// `system.worker_up`. Both are written already dispatched, with their notifications and
// deliveries due now, so the dispatcher of a worker that comes back never sends them again.
// Whether the worker is down is the latest of the two events: no table of its own.

/** The process name of the worker's rows. */
export const WORKER_PROCESS = 'worker'
export const WORKER_WATCH_LOCK = 'platform.worker_watch'
const ALARMS = ['system.worker_down', 'system.worker_up'] as const

export interface WorkerBeatDeps {
  uow: UnitOfWork
  clock: Clock
}

/** One beat of one worker instance (the host name of its container). */
export async function recordWorkerBeat(
  deps: WorkerBeatDeps,
  input: { instance: string; details: HeartbeatDetails },
): Promise<void> {
  const at = deps.clock.now()
  await deps.uow.runAsSystem(
    'platform: the worker beats',
    (tx) => tx.heartbeats.beat({ process: WORKER_PROCESS, ...input, at }),
    { routine: true },
  )
}

export interface WorkerWatchDeps extends DeliverDeps {
  /** The installation's lock: with more webs, one watch at a time */
  lock: ExclusiveLock
}

export type WorkerWatchOutcome =
  /** another web holds the watch */
  | 'busy'
  /** nothing changed */
  | 'same'
  | 'down'
  | 'up'

export interface WorkerWatchReport {
  outcome: WorkerWatchOutcome
  /** instances removed after 7 days of silence */
  retired: number
  /** groups sent by this run, the new event's and those of earlier ones still due */
  sent: number
}

interface Decided {
  outcome: Exclude<WorkerWatchOutcome, 'busy'>
  retired: number
  due: DeliveryRef[]
}

/**
 * One run of the watch. Never during the minute the web starts: a worker started with it has
 * not beaten yet, and there is no first row to compare with (a fresh install says nothing until
 * its worker has beaten once).
 */
export async function watchWorker(deps: WorkerWatchDeps): Promise<WorkerWatchReport> {
  const run = await deps.lock.tryRun(WORKER_WATCH_LOCK, async () => {
    const now = deps.clock.now()
    const decided = await deps.uow.runAsSystem(
      'platform: the watch over the worker',
      async (tx): Promise<Decided> => {
        const retired = await tx.heartbeats.removeSilentSince(
          new Date(now.getTime() - HEARTBEAT_RETIRED_MS),
        )
        const beats = (await tx.heartbeats.list()).filter((b) => b.process === WORKER_PROCESS)
        const last = await tx.outbox.latestPlatform(ALARMS)
        const silent = workerSilent(
          beats.map((b) => b.lastBeatAt),
          now,
        )
        const down = last?.type === 'system.worker_down'
        let outcome: Decided['outcome'] = 'same'
        // never beaten (or every row retired with no alarm before): nothing to compare with
        if (silent && !down && (beats.length > 0 || last !== null)) outcome = 'down'
        else if (!silent && down) outcome = 'up'
        const due: DeliveryRef[] = []
        if (outcome !== 'same') {
          const event = await tx.outbox.recordDispatched(
            {
              organizationId: null,
              type: outcome === 'down' ? 'system.worker_down' : 'system.worker_up',
              payload: { lastBeatAt: beats[0]?.lastBeatAt.toISOString() ?? null },
            },
            now,
          )
          if (event)
            for (const { notification } of await notificationsOf(deps, tx, event, now, now)) {
              const created = await tx.notifications.create(notification)
              if (created) due.push(...created.filter((d) => d.status === 'pending'))
            }
        }
        // while the worker is down nobody else sends the platform's: those whose try failed,
        // and those a web that fell left claimed (the worker's dispatcher would release them)
        if (silent || outcome === 'up') {
          const released = await tx.notifications.releaseExpiredClaims(
            now,
            { maxAttempts: DELIVERY_ATTEMPTS, gaveUp: deps.t('notify.errors.other') },
            'platform',
          )
          const listed = await tx.notifications.listDue(now, 100, 'platform')
          for (const ref of [...released, ...listed])
            if (!due.some((d) => d.id === ref.id)) due.push(ref)
        }
        return { outcome, retired, due }
      },
      { routine: true },
    )
    let sent = 0
    // after the commit, each group in its own short transactions, as `notify.deliver_platform`
    for (const ref of decided.due) {
      try {
        const report = await deliverGroup(
          deps,
          (fn) => deps.uow.runAsSystem('platform: the watch sends its alarm', fn),
          { deliveryId: ref.id, userId: ref.userId, organizationId: null },
        )
        if (report.outcome !== 'nothing') sent += 1
      } catch (error) {
        // the row stays due: the next minute tries again
        deps.logger.error({ err: error, deliveryId: ref.id }, 'worker alarm not delivered')
      }
    }
    if (decided.outcome !== 'same')
      deps.logger.warn({ outcome: decided.outcome, sent }, 'worker watch: the worker changed')
    return { outcome: decided.outcome, retired: decided.retired, sent }
  })
  return run.acquired ? run.value : { outcome: 'busy', retired: 0, sent: 0 }
}

/** One process as Piattaforma → Integrazioni shows it. */
export interface ProcessBeat extends HeartbeatRecord {
  health: BeatHealth
}

/** Every process's last beat, with its colour (green, amber past 1 minute, red past 2). */
export function beatsWithHealth(beats: readonly HeartbeatRecord[], now: Date): ProcessBeat[] {
  return beats.map((b) => ({ ...b, health: beatHealth(b.lastBeatAt, now) }))
}
