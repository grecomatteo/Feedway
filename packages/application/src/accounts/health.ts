import {
  can,
  connectionNeedsRefresh,
  DomainError,
  type ConnectionStatus,
  type OrgActor,
  type Platform,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import { assertActiveOrganization } from '../workspaces/index.js'
import type { ConnectionWithToken, SocialAccountRecord } from '../ports/accounts.js'
import type { Clock } from '../ports/clock.js'
import type { ConnectionTokens } from '../ports/connection-tokens.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type {
  AccountProblem,
  PlatformConnector,
  PlatformConnectors,
} from '../ports/platform-connector.js'
import type { RateLimiter } from '../ports/rate-limiter.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// The account jobs of §8.4 (plan 03 Task 10): the sync refreshes names and closes what is gone,
// the health check colours each account. Same pattern as the panel's calls: a transaction reads
// and opens the token, the platform is called outside, a second transaction writes what came
// back only if the connection is still the one that was read. Jobs act for no person: they open
// the agency's scope with `userId: null`, so who connected it does not matter (plan 03, choice 1).

export interface AccountJobsDeps {
  uow: UnitOfWork
  clock: Clock
  tokens: ConnectionTokens
  connectors: PlatformConnectors
  /** The sync queues the health check of the accounts it has just refreshed. */
  queue: Pick<JobQueue, 'send'>
  logger: Logger
}

/** The data of `accounts.sync` and `accounts.health`: ids only, never a token. */
export interface ConnectionJob {
  organizationId: string
  connectionId: string
}

export type JobOutcome =
  /** The connection is gone, no longer works, or changed while the platform answered. */
  | { outcome: 'skipped' }
  | { outcome: 'synced'; updated: number; inactive: number }
  | { outcome: 'checked'; accounts: number }
  /** The token stopped working: the connection and its accounts are red. */
  | { outcome: 'ended'; status: 'expired' | 'revoked' }

/** Both jobs of a connection, one at a time: the queue's key (stately policy). */
export const connectionJobKey = (job: ConnectionJob) => job.connectionId

/** At most one sync a request every 5 minutes per connection (plan 03 Task 10). */
export const SYNC_REQUEST_LIMIT = { limit: 1, windowMs: 5 * 60_000 }

const PROBLEM_MESSAGES: Record<AccountProblem, string> = {
  permission_missing: 'Manca un permesso Meta: genera di nuovo il token con tutti i permessi',
  role_missing:
    'L’utente di sistema non ha un ruolo sulla Pagina: assegnagliela in Business Manager',
  not_assigned: 'L’account non è più assegnato a questo collegamento su Meta',
  quota_exhausted: 'Quota di pubblicazione di Instagram esaurita: si libera nelle prossime ore',
}

const ENDED_MESSAGES: Record<'expired' | 'revoked', string> = {
  expired: 'Il token del collegamento non vale più: collegalo di nuovo',
  revoked: 'Il cliente ha tolto l’accesso a Meta: chiedigli di nuovo l’accesso e ricollega',
}

const works = (status: ConnectionStatus) => status === 'active' || status === 'pending'
const keyOf = (a: { platform: Platform; externalId: string }) => `${a.platform}:${a.externalId}`

/** A job whose agency or connection is missing is a bug of its producer: it fails at once. */
function assertJob(job: ConnectionJob): void {
  if (!isUuid(job.organizationId)) throw new Error('account job without organizationId')
  if (!isUuid(job.connectionId)) throw new Error('account job without connectionId')
}

const scopeOf = (job: ConnectionJob) => ({ organizationId: job.organizationId, userId: null })

interface Opened {
  connection: ConnectionWithToken
  connector: PlatformConnector
  app: unknown
  token: string
  /** The accounts it owns, active ones only: the inactive are not looked at any more. */
  accounts: SocialAccountRecord[]
}

function connectorFor(
  deps: Pick<AccountJobsDeps, 'connectors'>,
  kind: ConnectionWithToken['kind'],
) {
  const connector = deps.connectors[kind]
  if (!connector) throw new Error(`no platform connector for ${kind}`)
  return connector
}

/** null: nothing to do (no such connection here, not working, agency suspended, no app). */
async function openForJob(deps: AccountJobsDeps, job: ConnectionJob): Promise<Opened | null> {
  const { organizationId, connectionId } = job
  return deps.uow.run(scopeOf(job), async (tx) => {
    const organization = await tx.organizations.findById(organizationId)
    if (organization?.status !== 'active') return null
    const connection = await tx.connections.findWithToken(organizationId, connectionId)
    if (connection === null || !works(connection.status)) return null
    const connector = connectorFor(deps, connection.kind)
    const app = await connector.loadAppCredentials(tx, organizationId)
    if (app === null) return null
    const token = await deps.tokens.open(tx, {
      organizationId,
      id: connection.id,
      tokenEnc: connection.tokenEnc,
    })
    const accounts = (await tx.accounts.listOwnedBy(organizationId, connectionId)).filter(
      (a) => a.active,
    )
    return { connection, connector, app, token, accounts }
  })
}

/**
 * The row again, locked: the outcome is written only if the connection still works with the
 * token that was used. A token replaced meanwhile ("Sostituisci token") is not judged by an
 * answer about the old one.
 */
async function lockSame(tx: Tx, opened: Opened): Promise<boolean> {
  const { organizationId, id, tokenEnc } = opened.connection
  const now = await tx.connections.findWithToken(organizationId, id, { forUpdate: true })
  return now !== null && works(now.status) && now.tokenEnc === tokenEnc
}

function skipped(deps: AccountJobsDeps, job: ConnectionJob, why: string) {
  deps.logger.info({ connectionId: job.connectionId, why }, 'account job skipped')
  return { outcome: 'skipped' } as const
}

/**
 * `accounts.sync` (§8.4, plan 03 choices 2–3): names, pictures and pairs of the accounts the
 * connection owns; those gone from the platform become inactive, never deleted. Accounts not
 * imported are never created, and an inactive one does not come back on its own (the limit is
 * counted at the import). Then the health check of the same connection is queued.
 */
export async function syncConnection(
  deps: AccountJobsDeps,
  job: ConnectionJob,
): Promise<JobOutcome> {
  assertJob(job)
  const opened = await openForJob(deps, job)
  if (opened === null) return skipped(deps, job, 'connection not working')
  const listing = await opened.connector.listAccounts({ app: opened.app, token: opened.token })
  if (!listing.ok) {
    // a refused list says nothing about which accounts left: the health check says why
    if (listing.reason === 'rejected') {
      await queueHealth(deps, job)
      return skipped(deps, job, 'listing rejected')
    }
    // nothing is closed on a list that was not read whole; retried, and visible if it lasts
    throw new Error(`account listing ${listing.reason}`)
  }
  const seen = new Map(listing.accounts.map((a) => [keyOf(a), a]))
  const now = deps.clock.now()
  const { organizationId, connectionId } = job

  const result = await deps.uow.run(scopeOf(job), async (tx) => {
    // the import's lock: an account imported meanwhile is not closed by an older list
    await tx.accounts.lockImport(organizationId)
    if (!(await lockSame(tx, opened))) return null
    let updated = 0
    const gone: string[] = []
    for (const account of await tx.accounts.listOwnedBy(organizationId, connectionId)) {
      if (!account.active) continue
      const found = seen.get(keyOf(account))
      if (found === undefined) {
        gone.push(account.id)
        continue
      }
      if (
        await tx.accounts.updateFromPlatform(organizationId, connectionId, account.id, {
          name: found.name,
          username: found.username,
          avatarUrl: found.avatarUrl,
          pageId: found.pageId,
          at: now,
        })
      )
        updated += 1
    }
    const inactive = await tx.accounts.markInactive(organizationId, connectionId, gone)
    return { updated, inactive }
  })
  if (result === null) return skipped(deps, job, 'connection changed')
  await queueHealth(deps, job)
  return { outcome: 'synced', ...result }
}

/** The first check after an import, or the one after a sync. */
export async function queueHealth(
  deps: { queue: Pick<JobQueue, 'send'> },
  job: ConnectionJob,
): Promise<void> {
  await deps.queue.send(
    'accounts.health',
    { organizationId: job.organizationId, connectionId: job.connectionId },
    { singletonKey: connectionJobKey(job) },
  )
}

/** The connection and every account it owns turn red, with the reason (§8.4). */
async function endConnection(
  deps: AccountJobsDeps,
  job: ConnectionJob,
  opened: Opened,
  status: 'expired' | 'revoked',
): Promise<JobOutcome> {
  const { organizationId, connectionId } = job
  const at = deps.clock.now()
  const done = await deps.uow.run(scopeOf(job), async (tx) => {
    if (!(await lockSame(tx, opened))) return false
    await tx.connections.setStatus(organizationId, connectionId, status)
    for (const account of opened.accounts)
      await tx.accounts.setHealth(organizationId, connectionId, account.id, {
        health: 'error',
        message: ENDED_MESSAGES[status],
        quota: null,
        at,
      })
    return true
  })
  if (!done) return skipped(deps, job, 'connection changed')
  deps.logger.warn({ connectionId, status }, 'connection stopped working')
  return { outcome: 'ended', status }
}

/** Step 1 of `accounts.health`: a token that expires soon is renewed, if its kind allows it. */
async function renewIfNeeded(
  deps: AccountJobsDeps,
  job: ConnectionJob,
  opened: Opened,
): Promise<Opened | JobOutcome> {
  const now = deps.clock.now()
  const { connection } = opened
  if (!connectionNeedsRefresh(connection, now)) return opened
  const renewed = opened.connector.refresh
    ? await opened.connector.refresh({ app: opened.app, token: opened.token })
    : ({ ok: false, reason: 'not_renewable' } as const)
  if (!renewed.ok) {
    if (renewed.reason === 'unavailable') throw new Error('token renewal unavailable')
    const expired = connection.expiresAt !== null && connection.expiresAt <= now
    if (renewed.reason === 'rejected' || expired) return endConnection(deps, job, opened, 'expired')
    // still valid for a few days: checked as it is; the reminder is the daily run's (Task 11)
    return opened
  }
  const { organizationId, id } = connection
  const sealed = await deps.uow.run(scopeOf(job), async (tx) => {
    if (!(await lockSame(tx, opened))) return null
    const next = await deps.tokens.seal(tx, { organizationId, id }, renewed.token)
    await tx.connections.replaceToken(organizationId, id, {
      ...next,
      expiresAt: renewed.expiresAt,
      status: connection.status,
      at: now,
    })
    return next
  })
  if (sealed === null) return skipped(deps, job, 'connection changed')
  deps.logger.info({ connectionId: id }, 'connection token renewed')
  return {
    ...opened,
    token: renewed.token,
    connection: { ...connection, ...sealed, expiresAt: renewed.expiresAt, lastRefreshedAt: now },
  }
}

/**
 * `accounts.health` (§8.4): renews the token when its time comes, then checks every active
 * account the connection owns: health, message and quota. A token Meta no longer accepts makes
 * the connection `expired` (or `revoked`) and its accounts red; other connections are other
 * jobs and go on. When the platform cannot answer, nothing changes and the job fails, so the
 * queue retries it and the failure shows in the logs.
 */
export async function checkConnectionHealth(
  deps: AccountJobsDeps,
  job: ConnectionJob,
): Promise<JobOutcome> {
  assertJob(job)
  const first = await openForJob(deps, job)
  if (first === null) return skipped(deps, job, 'connection not working')
  const opened = await renewIfNeeded(deps, job, first)
  if ('outcome' in opened) return opened

  const check = await opened.connector.checkHealth(
    { app: opened.app, token: opened.token },
    opened.accounts.map((a) => ({
      platform: a.platform,
      externalId: a.externalId,
      pageId: a.pageId,
    })),
  )
  if (!check.ok) {
    if (check.reason === 'expired' || check.reason === 'revoked')
      return endConnection(deps, job, opened, check.reason)
    // the agency's app refused, or no answer: the accounts keep their last state
    throw new Error(`health check ${check.reason}`)
  }
  const reports = new Map(check.accounts.map((r) => [keyOf(r), r]))
  const at = deps.clock.now()
  const { organizationId, connectionId } = job
  const written = await deps.uow.run(scopeOf(job), async (tx) => {
    if (!(await lockSame(tx, opened))) return null
    let checked = 0
    for (const account of opened.accounts) {
      const report = reports.get(keyOf(account))
      if (report?.health == null) continue
      await tx.accounts.setHealth(organizationId, connectionId, account.id, {
        health: report.health,
        message: report.problem === null ? null : PROBLEM_MESSAGES[report.problem],
        quota: report.quota,
        at,
      })
      checked += 1
    }
    await tx.connections.recordUsage(organizationId, connectionId, check.usage)
    return checked
  })
  if (written === null) return skipped(deps, job, 'connection changed')
  return { outcome: 'checked', accounts: written }
}

export interface SyncRequestDeps {
  uow: UnitOfWork
  queue: Pick<JobQueue, 'send'>
  rateLimiter: Pick<RateLimiter, 'hit'>
}

/**
 * «Aggiorna» on a connection (§8.4): Owner and Admin queue its sync, at most once every 5
 * minutes; the health check follows the sync.
 */
export async function requestSync(
  deps: SyncRequestDeps,
  actor: OrgActor,
  input: { connectionId: string },
): Promise<void> {
  const { organizationId, userId } = actor
  const cannotManage = () =>
    new DomainError('FORBIDDEN', 'Solo Owner e Admin possono aggiornare gli account social')
  if (!can(actor, 'accounts.manage', { organizationId })) throw cannotManage()
  const notFound = () => new DomainError('NOT_FOUND', 'Collegamento non trovato')
  if (!isUuid(input.connectionId)) throw notFound()
  await deps.uow.run({ organizationId, userId }, async (tx) => {
    const membership = await tx.orgMembers.find(organizationId, userId)
    if (
      membership?.status !== 'active' ||
      !can({ ...actor, orgRole: membership.role }, 'accounts.manage', { organizationId })
    )
      throw cannotManage()
    await assertActiveOrganization(tx, organizationId)
    const connection = await tx.connections.findById(organizationId, input.connectionId)
    if (connection === null) throw notFound()
    if (!works(connection.status))
      throw new DomainError('CONFLICT', 'Il collegamento non funziona più: collegalo di nuovo')
  })
  const { limit, windowMs } = SYNC_REQUEST_LIMIT
  const { allowed, retryAfterMs } = await deps.rateLimiter.hit(
    `accounts.sync:${input.connectionId}`,
    limit,
    windowMs,
  )
  if (!allowed)
    throw new DomainError(
      'RATE_LIMITED',
      'Questo collegamento si è aggiornato da poco: riprova tra qualche minuto',
      { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
    )
  const job = { organizationId, connectionId: input.connectionId }
  await deps.queue.send('accounts.sync', job, { singletonKey: connectionJobKey(job) })
}
