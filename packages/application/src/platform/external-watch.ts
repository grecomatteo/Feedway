import { EXTERNAL_WATCH_TIMEOUT_MS } from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { ExternalPingResult, ExternalWatchPinger } from '../ports/external-watch.js'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { Logger } from '../ports/logger.js'
import type { ExclusiveLock } from '../ports/media-processing.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// `heartbeat.external` (§16.7, plan 08 Task 9): every minute one worker (the lock) calls the
// address of the `heartbeat` integration, so healthchecks.io or Uptime Kuma raise their alarm
// when the whole VPS stops and nobody calls any more. The address is the secret: it is read in
// clear only here and never goes to a log, an error or the state.

export const EXTERNAL_WATCH_LOCK = 'heartbeat.external'

/** The last outcome, in `integrations.state` of the `heartbeat` row. */
export interface ExternalWatchState {
  lastAt: string
  ok: boolean
  status: number | null
  problem: 'timeout' | 'network' | 'status' | null
}

export interface ExternalWatchDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  integrations: Pick<IntegrationStore, 'platformCredentials'>
  pinger: ExternalWatchPinger
  lock: ExclusiveLock
  /** Tests shorten it; 10 seconds otherwise */
  timeoutMs?: number
}

export type ExternalWatchReport =
  | { outcome: 'busy' | 'not_configured' }
  | { outcome: 'called'; result: ExternalPingResult; state: ExternalWatchState }

export function parseExternalWatchState(value: unknown): ExternalWatchState | null {
  const v = value as Partial<Record<keyof ExternalWatchState, unknown>> | null
  if (typeof v?.lastAt !== 'string' || typeof v.ok !== 'boolean') return null
  const problem =
    v.problem === 'timeout' || v.problem === 'network' || v.problem === 'status' ? v.problem : null
  return {
    lastAt: v.lastAt,
    ok: v.ok,
    status: typeof v.status === 'number' ? v.status : null,
    problem: v.ok ? null : problem,
  }
}

/** One call with its timeout; the pinger never throws, and a throw would be a bug. */
async function callOnce(
  deps: Pick<ExternalWatchDeps, 'pinger' | 'timeoutMs'>,
  url: string,
): Promise<ExternalPingResult> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? EXTERNAL_WATCH_TIMEOUT_MS)
  try {
    return await deps.pinger.ping(url, signal)
  } catch {
    return { ok: false, problem: signal.aborted ? 'timeout' : 'network', status: null }
  }
}

/** Calls the external watch now and keeps the outcome; the panel's «Prova» uses it too. */
export async function callExternalWatch(
  deps: Omit<ExternalWatchDeps, 'lock'>,
): Promise<ExternalWatchReport> {
  const credentials = await deps.uow.runAsSystem(
    'heartbeat.external: the address',
    (tx) => deps.integrations.platformCredentials(tx, 'heartbeat'),
    { routine: true },
  )
  if (!credentials) return { outcome: 'not_configured' }
  // no transaction while the network answers
  const result = await callOnce(deps, credentials.secret)
  const state: ExternalWatchState = {
    lastAt: deps.clock.now().toISOString(),
    ok: result.ok,
    status: result.status,
    problem: result.ok ? null : result.problem,
  }
  await deps.uow.runAsSystem(
    'heartbeat.external: the outcome',
    (tx) => tx.integrations.savePlatformState('heartbeat', state),
    { routine: true },
  )
  // the outcome only: never the address
  if (!result.ok)
    deps.logger.warn({ problem: result.problem, status: result.status }, 'external watch failed')
  return { outcome: 'called', result, state }
}

/** Job `heartbeat.external`: one worker at a time calls the watch. */
export async function pingExternalWatch(deps: ExternalWatchDeps): Promise<ExternalWatchReport> {
  const run = await deps.lock.tryRun(EXTERNAL_WATCH_LOCK, () => callExternalWatch(deps))
  return run.acquired ? run.value : { outcome: 'busy' }
}
