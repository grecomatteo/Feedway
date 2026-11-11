import {
  can,
  DomainError,
  formProfiles,
  isSelectable,
  seesAllWorkspaces,
  type AccountHealth,
  type ConnectionKind,
  type ConnectionStatus,
  type OrgActor,
  type Platform,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { SocialAccountRecord } from '../ports/accounts.js'
import type { AuditAction } from '../ports/audit-log.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  assertActiveOrganization,
  currentActor,
  lockVisibleWorkspace,
  workspaceNotFound,
} from '../workspaces/index.js'

// «Account social» (spec §14.4) and the profiles of a workspace (§3), plan 03 Task 9. Owner and
// Admin see every account with its connection; everyone else only the accounts of the
// workspaces they work in, without anything of the connection.

/** An account as a workspace sees it: nothing of the connection that reaches it. */
export interface WorkspaceAccount {
  id: string
  platform: Platform
  externalId: string
  name: string
  username: string | null
  avatarUrl: string | null
  /** The key of the profile (§3). */
  pageId: string | null
  active: boolean
  /** null: never checked yet. */
  health: AccountHealth | null
  healthMessage: string | null
  /** Can be a destination of a post now (§8.4). */
  selectable: boolean
  quotaUsed: number | null
  quotaTotal: number | null
  quotaCheckedAt: Date | null
  lastSyncedAt: Date | null
}

/** A row of «Account social». */
export interface AccountListItem extends WorkspaceAccount {
  /** The workspaces it is assigned to, among those the actor sees. */
  workspaceIds: string[]
  /** Only for those who manage the connections (Owner, Admin); null for everyone else. */
  connection: { id: string; kind: ConnectionKind; status: ConnectionStatus } | null
  createdAt: Date
}

export interface WorkspaceProfile {
  /** `page:<pageId>` or `account:<id>`, stable for the same accounts. */
  key: string
  /** The profile in the address (§14.6): its Instagram account, or its only one. */
  id: string
  accounts: WorkspaceAccount[]
}

export const DEFAULT_ACCOUNTS_PAGE = 50
export const MAX_ACCOUNTS_PAGE = 100

const invalid = (field: string) => new DomainError('VALIDATION', 'Valore non valido', { field })
const accountNotFound = () => new DomainError('NOT_FOUND', 'Account non trovato')
const cannotAssign = () =>
  new DomainError('FORBIDDEN', 'Solo Owner e Admin possono assegnare gli account agli spazi')
const archivedConflict = () =>
  new DomainError('CONFLICT', 'Lo spazio è archiviato: non si può modificare')
const inactiveConflict = () =>
  new DomainError(
    'CONFLICT',
    'L’account non è più attivo su Meta: ricollegalo prima di assegnarlo a uno spazio',
  )

const workspaceAccountOf = (a: SocialAccountRecord): WorkspaceAccount => ({
  id: a.id,
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: a.avatarUrl,
  pageId: a.pageId,
  active: a.active,
  health: a.health,
  healthMessage: a.healthMessage,
  selectable: isSelectable(a),
  quotaUsed: a.quotaUsed,
  quotaTotal: a.quotaTotal,
  quotaCheckedAt: a.quotaCheckedAt,
  lastSyncedAt: a.lastSyncedAt,
})

/**
 * The accounts assigned to a workspace, by name, inactive ones included (they stay in the
 * workspace but cannot be chosen). For the other modules (posts, calendar): the caller has
 * already checked that the actor sees the workspace.
 */
export async function accountsOfWorkspace(
  tx: Tx,
  organizationId: string,
  workspaceId: string,
): Promise<WorkspaceAccount[]> {
  const records = await tx.accounts.list(organizationId, { workspaceIds: [workspaceId] })
  return records.map(workspaceAccountOf)
}

function validPage(input: { cursor?: string; limit?: number }) {
  const { cursor, limit = DEFAULT_ACCOUNTS_PAGE } = input
  if (cursor !== undefined && (typeof cursor !== 'string' || !isUuid(cursor)))
    throw invalid('cursor')
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_ACCOUNTS_PAGE
  )
    throw invalid('limit')
  return { cursor, limit }
}

/**
 * «Account social», a page at a time by id (plan 03 Task 9): Owner and Admin every account of
 * the agency, the others only those of their workspaces. The cursor is the id of the last
 * account of the page before.
 */
export async function listAccounts(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { cursor?: string; limit?: number },
): Promise<{ items: AccountListItem[]; nextCursor: string | null }> {
  const { cursor, limit } = validPage(input)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    await assertActiveOrganization(tx, organizationId)
    const seesAll = seesAllWorkspaces(current)
    const visible = [...current.memberships.keys()]
    const records = await tx.accounts.listPage(organizationId, {
      ...(seesAll ? {} : { workspaceIds: visible }),
      ...(cursor === undefined ? {} : { afterId: cursor }),
      limit: limit + 1,
    })
    const page = records.slice(0, limit)
    const assigned = new Map<string, string[]>()
    for (const { accountId, workspaceId } of await tx.workspaceAccounts.listForAccounts(
      organizationId,
      page.map((a) => a.id),
    ))
      if (seesAll || current.memberships.has(workspaceId))
        assigned.set(accountId, [...(assigned.get(accountId) ?? []), workspaceId])
    const connections = can(current, 'accounts.manage', { organizationId })
      ? new Map((await tx.connections.list(organizationId)).map((c) => [c.id, c]))
      : null
    return {
      items: page.map((a) => {
        const c = connections?.get(a.connectionId)
        return {
          ...workspaceAccountOf(a),
          workspaceIds: assigned.get(a.id) ?? [],
          connection: c ? { id: c.id, kind: c.kind, status: c.status } : null,
          createdAt: a.createdAt,
        }
      }),
      nextCursor: records.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  })
}

/**
 * Runs `change` on an account of the agency and a workspace Owner or Admin may modify, the
 * workspace locked; archived ones refuse.
 */
async function changeAssignment(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  ids: { workspaceId: string; accountId: string },
  change: (tx: Tx, current: OrgActor, account: SocialAccountRecord) => Promise<boolean>,
  action: AuditAction,
  request: { ip: string | null },
): Promise<void> {
  const { organizationId } = actor
  if (!can(actor, 'workspace.accounts.assign', { organizationId })) throw cannotAssign()
  if (!isUuid(ids.workspaceId)) throw workspaceNotFound()
  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const fresh = await currentActor(tx, actor)
    if (!can(fresh, 'workspace.accounts.assign', { organizationId })) throw cannotAssign()
    await assertActiveOrganization(tx, organizationId)
    const { workspace, actor: current } = await lockVisibleWorkspace(tx, fresh, ids.workspaceId)
    if (workspace.archivedAt !== null) throw archivedConflict()
    const account = isUuid(ids.accountId)
      ? await tx.accounts.findById(organizationId, ids.accountId)
      : null
    if (account === null) throw accountNotFound()
    // the same assignment again changes and records nothing
    if (!(await change(tx, current, account))) return
    await tx.audit.record({
      organizationId,
      actorId: current.userId,
      source: 'panel',
      action,
      entity: 'account',
      entityId: account.id,
      workspaceId: workspace.id,
      ip: request.ip,
    })
  })
}

/** Puts an active account of the agency into a workspace (spec §8.2, §14.4). */
export async function assignAccount(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; accountId: string },
  request: { ip: string | null },
): Promise<void> {
  await changeAssignment(
    deps,
    actor,
    input,
    async (tx, current, account) => {
      if (!account.active) throw inactiveConflict()
      return tx.workspaceAccounts.assign(current.organizationId, input.workspaceId, account.id)
    },
    'account.assigned',
    request,
  )
}

/** Takes an account out of a workspace, inactive ones too. */
export async function unassignAccount(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; accountId: string },
  request: { ip: string | null },
): Promise<void> {
  await changeAssignment(
    deps,
    actor,
    input,
    (tx, current, account) =>
      tx.workspaceAccounts.unassign(current.organizationId, input.workspaceId, account.id),
    'account.unassigned',
    request,
  )
}

/**
 * The profiles of a workspace (§3), for whoever sees it: only its active accounts, so the other
 * half of a pair outside the workspace, or inactive, is never named. A workspace the actor does
 * not see is not found.
 */
export async function listProfiles(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<WorkspaceProfile[]> {
  if (!isUuid(input.workspaceId)) throw workspaceNotFound()
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    await assertActiveOrganization(tx, organizationId)
    const workspace = await tx.workspaces.findVisibleById(current, input.workspaceId)
    if (!workspace || (!seesAllWorkspaces(current) && !current.memberships.has(input.workspaceId)))
      throw workspaceNotFound()
    const accounts = await accountsOfWorkspace(tx, organizationId, workspace.id)
    return formProfiles(accounts).flatMap((p) => {
      const [first] = p.accounts
      return first ? [{ key: p.key, id: first.id, accounts: p.accounts }] : []
    })
  })
}
