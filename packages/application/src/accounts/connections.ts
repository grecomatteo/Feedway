import {
  canTakeOver,
  can,
  checkLimit,
  DomainError,
  parseLimits,
  PLATFORMS,
  type ConnectionKind,
  type ConnectionStatus,
  type OrgActor,
} from '@app/domain'
import { assertRecentReauth, isUuid } from '../identity/index.js'
import { assertActiveOrganization } from '../workspaces/index.js'
import type { ConnectionRecord, SocialAccountRecord } from '../ports/accounts.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { ConnectionTokens } from '../ports/connection-tokens.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type {
  PermissionCheck,
  PlatformAccount,
  PlatformConnector,
  PlatformConnectors,
} from '../ports/platform-connector.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { queueHealth } from './health.js'

// Connections and their import (spec §8.1 steps 4–5, §8.2, plan 03 Task 6). The platform is
// never called inside a transaction: read and open the token, close, call, then write over what
// is still there. The token lives in memory for the call only and leaves in no answer, log or
// activity entry.

export interface ConnectionsDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  tokens: ConnectionTokens
  connectors: PlatformConnectors
  /** The first health check after an import (§8.2). */
  queue: Pick<JobQueue, 'send'>
  logger: Logger
}

/** A connection as Owner and Admin see it: never its token. */
export interface ConnectionView {
  id: string
  kind: ConnectionKind
  status: ConnectionStatus
  /** null: the token does not expire. */
  expiresAt: Date | null
  createdAt: Date
}

/**
 * `imported`: this connection owns it. `other_connection`: another working connection owns it
 * (plan 03, choice 2). `to_import`: new, inactive, or owned by a connection that no longer
 * works. `not_importable`: the platform says why in `problem`.
 */
export type ImportableState = 'imported' | 'other_connection' | 'to_import' | 'not_importable'

export interface ImportableAccount extends PlatformAccount {
  state: ImportableState
  /** The Feedway account, when there is one already. */
  accountId: string | null
}

export type ConnectOutcome = 'connected' | 'replaced' | 'permissions_missing'

export interface ConnectWithTokenResult {
  outcome: ConnectOutcome
  /** Every permission the kind needs, green or red. */
  permissions: PermissionCheck[]
  /** null: nothing was saved. */
  connection: ConnectionView | null
  accounts: ImportableAccount[]
}

/** At most this many accounts in one import: a few screens of choices. */
export const MAX_IMPORT = 100
/** A pasted token far beyond any real one is junk, not a token. */
const MAX_TOKEN_LENGTH = 4096

const cannotManage = () =>
  new DomainError('FORBIDDEN', 'Solo Owner e Admin possono collegare gli account social')
const connectionNotFound = () => new DomainError('NOT_FOUND', 'Collegamento non trovato')
const appNotConfigured = () =>
  new DomainError(
    'CONFLICT',
    'Configura prima l’app Meta dell’agenzia in Impostazioni → Integrazioni',
  )
const appRejected = () =>
  new DomainError(
    'CONFLICT',
    'Meta non accetta più l’app dell’agenzia: controlla Impostazioni → Integrazioni → Meta',
  )
const unavailable = () =>
  new DomainError('PLATFORM_UNAVAILABLE', 'Meta non risponde: riprova tra qualche minuto')
const tokenRejected = () =>
  new DomainError('VALIDATION', 'Meta non accetta questo token per l’app dell’agenzia', {
    field: 'token',
  })
const listingRejected = () =>
  new DomainError(
    'CONFLICT',
    'Meta non mostra gli account di questo collegamento: controlla il token e le risorse assegnate all’utente di sistema',
  )
const listingError = (reason: 'rejected' | 'unavailable' | 'incomplete') =>
  reason === 'unavailable'
    ? unavailable()
    : reason === 'incomplete'
      ? new DomainError(
          'CONFLICT',
          'Meta manda un elenco di account che non finisce: Feedway non l’ha letto per intero',
        )
      : listingRejected()
const notWorking = () =>
  new DomainError('CONFLICT', 'Il collegamento non funziona più: collegalo di nuovo')

/** Opaque to this module: equal when the platform's module would build the same value. */
const sameApp = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const works = (status: ConnectionStatus) => status === 'active' || status === 'pending'

const viewOf = (c: ConnectionRecord): ConnectionView => ({
  id: c.id,
  kind: c.kind,
  status: c.status,
  expiresAt: c.expiresAt,
  createdAt: c.createdAt,
})

/** The role read again inside the transaction: a change since the actor was resolved counts. */
async function assertStillManages(tx: Tx, actor: OrgActor): Promise<void> {
  const { organizationId } = actor
  const membership = await tx.orgMembers.find(organizationId, actor.userId)
  if (
    membership?.status !== 'active' ||
    !can({ ...actor, orgRole: membership.role }, 'accounts.manage', { organizationId })
  )
    throw cannotManage()
}

function connectorFor(deps: Pick<ConnectionsDeps, 'connectors'>, kind: ConnectionKind) {
  const connector = deps.connectors[kind]
  // a kind without a connector in this process is a wiring bug, never the person's mistake
  if (!connector) throw new Error(`no platform connector for ${kind}`)
  return connector
}

/** The accounts seen, each with what importing it would do (plan 03, choices 2 and 3). */
async function annotate(
  tx: Tx,
  organizationId: string,
  connection: { id: string; status: ConnectionStatus },
  accounts: readonly PlatformAccount[],
): Promise<ImportableAccount[]> {
  const known = new Map<string, SocialAccountRecord>()
  for (const platform of PLATFORMS) {
    const ids = accounts.filter((a) => a.platform === platform).map((a) => a.externalId)
    if (ids.length === 0) continue
    for (const record of await tx.accounts.findByExternalIds(organizationId, platform, ids))
      known.set(`${platform}:${record.externalId}`, record)
  }
  const owners = new Map<string, ConnectionRecord | null>()
  const ownerOf = async (id: string) => {
    if (!owners.has(id)) owners.set(id, await tx.connections.findById(organizationId, id))
    return owners.get(id) ?? null
  }

  const out: ImportableAccount[] = []
  for (const account of accounts) {
    const record = known.get(`${account.platform}:${account.externalId}`)
    let state: ImportableState
    if (record?.connectionId === connection.id && record.active) state = 'imported'
    else if (account.problem !== null) state = 'not_importable'
    else if (record === undefined || record.connectionId === connection.id) state = 'to_import'
    else {
      const owner = await ownerOf(record.connectionId)
      state = owner === null || canTakeOver(owner, connection) ? 'to_import' : 'other_connection'
    }
    out.push({ ...account, state, accountId: record?.id ?? null })
  }
  return out
}

/**
 * "Genera e incolla il token" (spec §8.1 step 4): Owner and Admin, with a recent reauth. The
 * platform checks the token and its permissions first: only a valid token with every permission
 * is saved, as a new `pending` connection, or as the new token of the connection of the same
 * platform user ("Sostituisci token", §8.3): the old one works until the new one is verified.
 */
export async function connectWithToken(
  deps: ConnectionsDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: { kind: ConnectionKind; token: string },
  request: { ip: string | null },
): Promise<ConnectWithTokenResult> {
  if (session.userId !== actor.userId)
    throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
  const { organizationId, userId } = actor
  if (!can(actor, 'accounts.manage', { organizationId })) throw cannotManage()
  const connector = connectorFor(deps, input.kind)
  if (!connector.connectWithToken)
    throw new DomainError('VALIDATION', 'Questo tipo di collegamento non usa un token', {
      field: 'kind',
    })
  // a pasted token often carries a space or a line break around it
  const token = input.token.trim()
  if (token === '' || token.length > MAX_TOKEN_LENGTH)
    throw new DomainError('VALIDATION', 'Incolla il token dell’utente di sistema', {
      field: 'token',
    })
  assertRecentReauth(session, deps.clock.now())
  const scope = { organizationId, userId }

  const app = await deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    return connector.loadAppCredentials(tx, organizationId)
  })
  if (app === null) throw appNotConfigured()

  const check = await connector.connectWithToken(app, token)
  if (!check.ok) {
    if (check.reason === 'unavailable') throw unavailable()
    if (check.reason === 'app_rejected') throw appRejected()
    if (check.reason === 'rejected') throw tokenRejected()
    return {
      outcome: 'permissions_missing',
      permissions: check.permissions,
      connection: null,
      accounts: [],
    }
  }
  const listing = await connector.listAccounts({ app, token })
  if (!listing.ok) throw listingError(listing.reason)
  const now = deps.clock.now()

  return deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    // the same lock as the imports: two pastes of the same user make one connection
    await tx.accounts.lockImport(organizationId)
    await assertActiveOrganization(tx, organizationId)
    // the token was checked against this app: another one saved meanwhile would not take it
    const appNow = await connector.loadAppCredentials(tx, organizationId)
    if (appNow === null || !sameApp(appNow, app))
      throw new DomainError('CONFLICT', 'L’app Meta dell’agenzia è cambiata nel frattempo: riprova')
    const existing = await tx.connections.findByExternalUser(
      organizationId,
      input.kind,
      check.externalUserId,
    )
    let connection: ConnectionRecord
    if (existing === null) {
      const id = deps.ids.newId()
      const sealed = await deps.tokens.seal(tx, { organizationId, id }, token)
      connection = await tx.connections.create({
        id,
        organizationId,
        kind: input.kind,
        externalUserId: check.externalUserId,
        connectedBy: userId,
        ...sealed,
        expiresAt: check.expiresAt,
      })
    } else {
      const sealed = await deps.tokens.seal(tx, { organizationId, id: existing.id }, token)
      // a connection with accounts works again at once; a new one stays pending (choice 6)
      const status: ConnectionStatus = existing.status === 'pending' ? 'pending' : 'active'
      await tx.connections.replaceToken(organizationId, existing.id, {
        ...sealed,
        expiresAt: check.expiresAt,
        status,
        at: now,
      })
      connection = { ...existing, status, expiresAt: check.expiresAt }
    }
    await tx.audit.record({
      organizationId,
      actorId: userId,
      source: 'panel',
      action: existing === null ? 'connection.created' : 'connection.token_replaced',
      entity: 'connection',
      entityId: connection.id,
      workspaceId: null,
      ip: request.ip,
      data: { kind: input.kind },
    })
    return {
      outcome: existing === null ? 'connected' : 'replaced',
      permissions: check.permissions,
      connection: viewOf(connection),
      accounts: await annotate(tx, organizationId, connection, listing.accounts),
    }
  })
}

interface OpenedConnection {
  connection: ConnectionRecord
  connector: PlatformConnector
  app: unknown
  token: string
}

/** A working connection of the agency with its token opened, for one call to the platform. */
async function openConnection(
  deps: ConnectionsDeps,
  actor: OrgActor,
  connectionId: string,
): Promise<OpenedConnection> {
  if (!can(actor, 'accounts.manage', { organizationId: actor.organizationId })) throw cannotManage()
  if (!isUuid(connectionId)) throw connectionNotFound()
  const { organizationId, userId } = actor
  return deps.uow.run({ organizationId, userId }, async (tx) => {
    await assertStillManages(tx, actor)
    const found = await tx.connections.findWithToken(organizationId, connectionId)
    if (found === null) throw connectionNotFound()
    if (!works(found.status)) throw notWorking()
    const connector = connectorFor(deps, found.kind)
    const app = await connector.loadAppCredentials(tx, organizationId)
    if (app === null) throw appNotConfigured()
    const token = await deps.tokens.open(tx, {
      organizationId,
      id: found.id,
      tokenEnc: found.tokenEnc,
    })
    // the sealed token stays here: only the opened one leaves, for the one call
    const connection: ConnectionRecord = {
      id: found.id,
      organizationId: found.organizationId,
      kind: found.kind,
      externalUserId: found.externalUserId,
      connectedBy: found.connectedBy,
      expiresAt: found.expiresAt,
      status: found.status,
      lastRefreshedAt: found.lastRefreshedAt,
      lastUsage: found.lastUsage,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
    }
    return { connection, connector, app, token }
  })
}

async function listLive(opened: OpenedConnection): Promise<PlatformAccount[]> {
  const listing = await opened.connector.listAccounts({ app: opened.app, token: opened.token })
  if (!listing.ok) throw listingError(listing.reason)
  return listing.accounts
}

/**
 * «Cerca nuovi account» (§8.2, plan 03 choice 3): what the connection sees now, read live, each
 * with its state. Nothing is written.
 */
export async function listImportable(
  deps: ConnectionsDeps,
  actor: OrgActor,
  input: { connectionId: string },
): Promise<{ connection: ConnectionView; accounts: ImportableAccount[] }> {
  const opened = await openConnection(deps, actor, input.connectionId)
  const accounts = await listLive(opened)
  const { organizationId, userId } = actor
  return deps.uow.run({ organizationId, userId }, async (tx) => ({
    connection: viewOf(opened.connection),
    accounts: await annotate(tx, organizationId, opened.connection, accounts),
  }))
}

/**
 * Step 5 of §8.1: imports the chosen accounts into the agency, out of every workspace until an
 * Admin assigns them. Only accounts the connection sees right now; an account of another
 * working connection stays there (choice 2); the `social_accounts` limit counts under the
 * agency's import lock, so two imports never both take the last slot. The connection becomes
 * `active` (choice 6). The first health check is queued once the import is saved: until it
 * runs a new account is "never checked" and cannot be chosen for a post.
 */
export async function importAccounts(
  deps: ConnectionsDeps,
  actor: OrgActor,
  input: { connectionId: string; externalIds: readonly string[] },
  request: { ip: string | null },
): Promise<{ connection: ConnectionView; accounts: SocialAccountRecord[] }> {
  const chosenIds = [...new Set(input.externalIds)]
  if (chosenIds.length === 0 || chosenIds.length > MAX_IMPORT)
    throw new DomainError(
      'VALIDATION',
      `Scegli da 1 a ${String(MAX_IMPORT)} account da importare`,
      { field: 'externalIds' },
    )
  const opened = await openConnection(deps, actor, input.connectionId)
  const seen = await listLive(opened)
  const chosen = chosenIds.map((id) => seen.find((a) => a.externalId === id && a.problem === null))
  if (chosen.some((a) => a === undefined))
    throw new DomainError(
      'VALIDATION',
      'Uno degli account scelti non è visibile da questo collegamento, o non si può importare',
      { field: 'externalIds' },
    )
  const accounts = chosen as PlatformAccount[]
  const { organizationId, userId } = actor

  const result = await deps.uow.run({ organizationId, userId }, async (tx) => {
    await assertStillManages(tx, actor)
    await tx.accounts.lockImport(organizationId)
    const organization = await assertActiveOrganization(tx, organizationId)
    // read again and locked: it may have stopped working while the platform answered, and a
    // health check that ends it now waits for this import, then finds it as it is left
    const locked = await tx.connections.findWithToken(organizationId, opened.connection.id, {
      forUpdate: true,
    })
    if (locked === null) throw connectionNotFound()
    const connection: ConnectionRecord = {
      id: locked.id,
      organizationId: locked.organizationId,
      kind: locked.kind,
      externalUserId: locked.externalUserId,
      connectedBy: locked.connectedBy,
      expiresAt: locked.expiresAt,
      status: locked.status,
      lastRefreshedAt: locked.lastRefreshedAt,
      lastUsage: locked.lastUsage,
      createdAt: locked.createdAt,
      updatedAt: locked.updatedAt,
    }
    if (!works(connection.status)) throw notWorking()

    const states = await annotate(tx, organizationId, connection, accounts)
    if (states.some((a) => a.state === 'other_connection'))
      throw new DomainError(
        'CONFLICT',
        'Uno degli account scelti è già di un altro collegamento che funziona',
        { field: 'externalIds' },
      )
    const active = new Set<string>()
    for (const platform of PLATFORMS) {
      const ids = states.filter((a) => a.platform === platform).map((a) => a.externalId)
      if (ids.length > 0)
        for (const r of await tx.accounts.findByExternalIds(organizationId, platform, ids))
          if (r.active) active.add(r.id)
    }
    // only what is not active yet counts: a new account, or an inactive one coming back
    const adding = states.filter((a) => a.accountId === null || !active.has(a.accountId)).length
    const check = checkLimit(
      parseLimits(organization.limits),
      'social_accounts',
      await tx.accounts.countActive(organizationId),
      adding,
    )
    if (!check.ok)
      throw new DomainError(
        'LIMIT_REACHED',
        'L’agenzia ha raggiunto il numero massimo di account social',
        { limit: check.limit },
      )

    const now = deps.clock.now()
    const imported: SocialAccountRecord[] = []
    for (const a of states)
      imported.push(
        await tx.accounts.upsertImported({
          organizationId,
          platform: a.platform,
          externalId: a.externalId,
          name: a.name,
          username: a.username,
          avatarUrl: a.avatarUrl,
          pageId: a.pageId,
          connectionId: connection.id,
          at: now,
        }),
      )
    let status = connection.status
    if (status === 'pending') {
      await tx.connections.setStatus(organizationId, connection.id, 'active')
      status = 'active'
    }
    await tx.audit.record({
      organizationId,
      actorId: userId,
      source: 'panel',
      action: 'accounts.imported',
      entity: 'connection',
      entityId: connection.id,
      workspaceId: null,
      ip: request.ip,
      data: { count: imported.length },
    })
    return { connection: viewOf({ ...connection, status }), accounts: imported }
  })
  // after the commit, so the check finds the accounts; if the queue fails the import stays and
  // the daily run checks them (Task 11)
  try {
    await queueHealth(deps, { organizationId, connectionId: result.connection.id })
  } catch (error) {
    deps.logger.error(
      { err: error, connectionId: result.connection.id },
      'first health check not queued',
    )
  }
  return result
}
