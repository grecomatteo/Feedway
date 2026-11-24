import type { PlatformMonitoring } from '@app/application'
import { createExternalWatchPinger } from '@app/infrastructure'
import type { Deps } from './deps'

const pinger = createExternalWatchPinger()

/** The worker's beats and the external watch (plan 08 Task 9). */
export function monitoringDeps(deps: Deps) {
  return {
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    integrations: deps.integrations,
    pinger,
  }
}

export function lastOutcomeDto(
  state: {
    lastAt: string
    ok: boolean
    status: number | null
    problem: 'timeout' | 'network' | 'status' | null
  } | null,
) {
  return state === null
    ? null
    : { at: state.lastAt, ok: state.ok, status: state.status, problem: state.problem }
}

/** What leaves for the panel: never the address of the watch. */
export function monitoringDto(view: PlatformMonitoring) {
  return {
    workers: view.workers.map((w) => ({
      instance: w.instance,
      lastBeatAt: w.lastBeatAt.toISOString(),
      health: w.health,
      version: w.details?.version ?? null,
    })),
    external:
      view.external === null
        ? null
        : {
            addressSet: true as const,
            updatedAt: view.external.updatedAt.toISOString(),
            last: lastOutcomeDto(view.external.state),
          },
  }
}

/** Each test is a call out of the VPS; a save is a reauth-protected write. */
export const EXTERNAL_WATCH_RATE_LIMIT = { name: 'external-watch', limit: 10, windowMs: 60_000 }
