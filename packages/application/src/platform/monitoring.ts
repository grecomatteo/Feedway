import { DomainError, externalWatchUrlProblem, type ExternalWatchUrlProblem } from '@app/domain'
import { assertRecentReauth } from '../identity/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { ExternalPingResult, ExternalWatchPinger } from '../ports/external-watch.js'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { Logger } from '../ports/logger.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  callExternalWatch,
  parseExternalWatchState,
  type ExternalWatchState,
} from './external-watch.js'
import {
  assertPlatform,
  callerIsSystem,
  NO_REQUEST,
  platformAuthor,
  type PlatformCaller,
  type PlatformRequest,
} from './platform-actor.js'
import { WORKER_PROCESS, beatsWithHealth, type ProcessBeat } from './worker-watch.js'

// Piattaforma → Integrazioni (plan 08 Task 9): the worker's last beats and the external watch.
// Until the dashboard of stage 11 this is where the administrator sees that the worker beats.
// The watch's address is the secret: it goes in and never comes back, not even in part.

export interface PlatformMonitoringDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  integrations: IntegrationStore
  pinger: ExternalWatchPinger
}

export interface PlatformMonitoringRequest extends PlatformRequest {
  session: AuthSessionInfo | null
}

const FROM_CLI: PlatformMonitoringRequest = { ...NO_REQUEST, session: null }
const ENTITY = 'integration'

const PROBLEM_TEXT: Record<ExternalWatchUrlProblem, string> = {
  invalid: 'Incolla l’indirizzo completo del controllo, per esempio https://hc-ping.com/…',
  not_https: 'L’indirizzo deve iniziare con https://',
  credentials: 'L’indirizzo non può contenere nome utente e password',
}

export interface PlatformMonitoring {
  /** every instance of the worker, the most recent beat first */
  workers: ProcessBeat[]
  /** null: no address set */
  external: { updatedAt: Date; state: ExternalWatchState | null } | null
}

function assertPanelReauth(
  clock: Clock,
  caller: PlatformCaller,
  request: PlatformMonitoringRequest,
) {
  if (callerIsSystem(caller)) return
  if (request.session === null)
    throw new DomainError('REAUTH_REQUIRED', 'Conferma la tua identità per continuare')
  if (request.session.userId !== caller.userId)
    throw new DomainError('FORBIDDEN', 'Solo l’amministratore della piattaforma può farlo')
  assertRecentReauth(request.session, clock.now())
}

/** What the page shows: the beats with their colour, and the watch without its address. */
export async function getPlatformMonitoring(
  deps: Pick<PlatformMonitoringDeps, 'uow' | 'clock' | 'integrations'>,
  caller: PlatformCaller,
  request: PlatformRequest = NO_REQUEST,
): Promise<PlatformMonitoring> {
  assertPlatform(caller, 'platform.integrations.manage')
  return deps.uow.runAsSystem('platform: read the monitoring', async (tx) => {
    await platformAuthor(tx, caller, request)
    const beats = (await tx.heartbeats.list()).filter((b) => b.process === WORKER_PROCESS)
    const watch = await deps.integrations.getPlatform(tx, 'heartbeat')
    return {
      workers: beatsWithHealth(beats, deps.clock.now()),
      external:
        watch === null
          ? null
          : {
              updatedAt: watch.updatedAt,
              state: parseExternalWatchState(await tx.integrations.platformState('heartbeat')),
            },
    }
  })
}

/** Saves the address of healthchecks.io; the activity entry says it changed, never what it is. */
export async function replaceExternalWatch(
  deps: Pick<PlatformMonitoringDeps, 'uow' | 'clock' | 'integrations'>,
  caller: PlatformCaller,
  input: { url: string },
  request: PlatformMonitoringRequest = FROM_CLI,
): Promise<void> {
  assertPlatform(caller, 'platform.integrations.manage')
  assertPanelReauth(deps.clock, caller, request)
  const url = input.url.trim()
  const problem = externalWatchUrlProblem(url)
  if (problem !== null) throw new DomainError('VALIDATION', PROBLEM_TEXT[problem], { field: 'url' })
  await deps.uow.runAsSystem('platform: change the external watch', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    await deps.integrations.replacePlatform(tx, 'heartbeat', {
      config: {},
      secret: url,
      updatedBy: author.actorId,
    })
    // a new address has no outcome yet
    await tx.integrations.savePlatformState('heartbeat', {})
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'platform.external_watch_changed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: author.ip,
      data: {},
    })
  })
}

/** Takes the address away: nothing is called any more, and healthchecks.io will raise its alarm. */
export async function removeExternalWatch(
  deps: Pick<PlatformMonitoringDeps, 'uow' | 'clock' | 'integrations'>,
  caller: PlatformCaller,
  request: PlatformMonitoringRequest = FROM_CLI,
): Promise<void> {
  assertPlatform(caller, 'platform.integrations.manage')
  assertPanelReauth(deps.clock, caller, request)
  await deps.uow.runAsSystem('platform: remove the external watch', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    if (!(await tx.integrations.deletePlatform('heartbeat'))) return
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'platform.external_watch_removed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: author.ip,
      data: {},
    })
  })
}

export type ExternalWatchTest =
  | { outcome: 'not_configured' }
  | { outcome: 'called'; result: ExternalPingResult; state: ExternalWatchState }

/** «Prova»: one call now, kept as the last outcome like the job's. */
export async function testExternalWatch(
  deps: PlatformMonitoringDeps,
  caller: PlatformCaller,
  request: PlatformRequest = NO_REQUEST,
): Promise<ExternalWatchTest> {
  assertPlatform(caller, 'platform.integrations.manage')
  await deps.uow.runAsSystem('platform: external watch before a test', (tx) =>
    platformAuthor(tx, caller, request),
  )
  const report = await callExternalWatch(deps)
  return report.outcome === 'called' ? report : { outcome: 'not_configured' }
}
