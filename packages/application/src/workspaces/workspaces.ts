import {
  availableWorkspaceSlug,
  can,
  checkLimit,
  DomainError,
  checkOrganizationName,
  parseLimits,
  seesAllWorkspaces,
  type OrgActor,
  type WorkspaceRole,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Auth } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { WorkspaceRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export interface WorkspacesDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  auth: Pick<Auth, 'revokeAllSessions'>
}

/** A workspace as the panel shows it; Owner and Admin see every one with their agency role. */
export interface WorkspaceDto {
  id: string
  name: string
  slug: string
  archivedAt: string | null
  myRole: WorkspaceRole | 'owner' | 'admin'
}

export const workspaceNotFound = () => new DomainError('NOT_FOUND', 'Spazio non trovato')
export const cannotManage = () =>
  new DomainError('FORBIDDEN', 'Solo Owner e Admin possono creare e modificare gli spazi')
const archivedConflict = () =>
  new DomainError('CONFLICT', 'Lo spazio è archiviato: non si può modificare')

function myRole(actor: OrgActor, workspaceId: string): WorkspaceDto['myRole'] | undefined {
  if (actor.orgRole === 'owner' || actor.orgRole === 'admin') return actor.orgRole
  return actor.memberships.get(workspaceId)
}

function toDto(record: WorkspaceRecord, role: WorkspaceDto['myRole']): WorkspaceDto {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    archivedAt: record.archivedAt === null ? null : record.archivedAt.toISOString(),
    myRole: role,
  }
}

/**
 * The actor as the database sees them now: an agency role or a workspace role changed since the
 * actor was resolved must not pass. Read inside the transaction that acts.
 */
export async function currentActor(tx: Tx, actor: OrgActor): Promise<OrgActor> {
  const { organizationId, userId } = actor
  const membership = await tx.orgMembers.find(organizationId, userId)
  if (membership?.status !== 'active')
    throw new DomainError('FORBIDDEN', 'Non hai più accesso a questa agenzia')
  return {
    ...actor,
    orgRole: membership.role,
    memberships: await tx.workspaceMembers.rolesOf(organizationId, userId),
  }
}

/** A suspended agency changes nothing (its routes answer 403 from the next request). */
export async function assertActiveOrganization(tx: Tx, organizationId: string) {
  const organization = await tx.organizations.findById(organizationId)
  if (!organization) throw new DomainError('NOT_FOUND', 'Agenzia non trovata')
  if (organization.status !== 'active')
    throw new DomainError('ORGANIZATION_SUSPENDED', 'Questa agenzia è sospesa')
  return organization
}

/**
 * A workspace the actor sees, locked until the transaction ends: every change to a workspace
 * and to its members takes this lock first, so they go one at a time. The actor's workspace
 * roles are read again after the lock, when nobody can change them any more.
 */
export async function lockVisibleWorkspace(
  tx: Tx,
  actor: OrgActor,
  workspaceId: string,
): Promise<{ workspace: WorkspaceRecord; actor: OrgActor }> {
  if (!isUuid(workspaceId)) throw workspaceNotFound()
  const workspace = await tx.workspaces.findVisibleByIdForUpdate(actor, workspaceId)
  if (!workspace) throw workspaceNotFound()
  const memberships = await tx.workspaceMembers.rolesOf(actor.organizationId, actor.userId)
  const current = { ...actor, memberships }
  if (!seesAllWorkspaces(current) && !memberships.has(workspaceId)) throw workspaceNotFound()
  return { workspace, actor: current }
}

export function validName(raw: string): string {
  // the same bounds as an agency name (spec §13)
  const checked = checkOrganizationName(raw)
  if (!checked.ok)
    throw new DomainError(
      'VALIDATION',
      checked.reason === 'LENGTH'
        ? 'Il nome dello spazio va da 2 a 80 caratteri'
        : 'Il nome dello spazio non può contenere link o caratteri speciali',
      { field: 'name' },
    )
  return checked.value
}

export const managesWorkspaces = (actor: OrgActor) =>
  can(actor, 'workspace.create', { organizationId: actor.organizationId })

export function recordWorkspace(
  tx: Tx,
  actor: OrgActor,
  action: 'workspace.created' | 'workspace.renamed' | 'workspace.archived',
  workspaceId: string,
  ip: string | null,
) {
  // no name or slug: a client's name can be a person's
  return tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'workspace',
    entityId: workspaceId,
    workspaceId,
    ip,
  })
}

/**
 * A new workspace inside the caller's transaction, for the actor read again in it: the creations
 * of one agency go one at a time, so neither the last slot of the `workspaces` limit (only the
 * workspaces not archived count) nor a slug is taken twice. The slug comes from the name and gets
 * a suffix when it is taken.
 */
export async function addWorkspace(
  tx: Tx,
  ids: IdGenerator,
  current: OrgActor,
  name: string,
  request: { ip: string | null },
): Promise<WorkspaceDto> {
  const { organizationId } = current
  await tx.workspaces.lockCreation(organizationId)
  const organization = await assertActiveOrganization(tx, organizationId)
  const check = checkLimit(
    parseLimits(organization.limits),
    'workspaces',
    await tx.workspaces.countActive(organizationId),
  )
  if (!check.ok)
    throw new DomainError('LIMIT_REACHED', 'L’agenzia ha raggiunto il numero massimo di spazi', {
      limit: check.limit,
    })
  const slug = await availableWorkspaceSlug(name, (s) =>
    tx.workspaces.slugExists(organizationId, s),
  )
  const created = await tx.workspaces.create({ id: ids.newId(), organizationId, name, slug })
  await recordWorkspace(tx, current, 'workspace.created', created.id, request.ip)
  return toDto(created, current.orgRole === 'owner' ? 'owner' : 'admin')
}

/** At most this many profiles' accounts in one new client. */
export const MAX_CLIENT_ACCOUNTS = 20

const cannotAssign = () =>
  new DomainError('FORBIDDEN', 'Solo Owner e Admin possono assegnare gli account agli spazi')

/**
 * Owner and Admin create workspaces (spec §10.2). With `accountIds` the client is born from
 * profiles already imported (§14.7): each account of the agency, active, is assigned in the same
 * transaction, which also needs `workspace.accounts.assign`.
 */
export async function createWorkspace(
  deps: Pick<WorkspacesDeps, 'uow' | 'ids'>,
  actor: OrgActor,
  input: { name: string; accountIds?: readonly string[] },
  request: { ip: string | null },
): Promise<WorkspaceDto> {
  if (!managesWorkspaces(actor)) throw cannotManage()
  const name = validName(input.name)
  const accountIds = [...new Set(input.accountIds ?? [])]
  if (accountIds.length > MAX_CLIENT_ACCOUNTS)
    throw new DomainError('VALIDATION', 'Troppi account per un cliente', { field: 'accountIds' })
  const { organizationId } = actor
  const assigns = (a: OrgActor) => can(a, 'workspace.accounts.assign', { organizationId })
  if (accountIds.length > 0 && !assigns(actor)) throw cannotAssign()
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    if (!managesWorkspaces(current)) throw cannotManage()
    if (accountIds.length > 0 && !assigns(current)) throw cannotAssign()
    const created = await addWorkspace(tx, deps.ids, current, name, request)
    for (const accountId of accountIds) {
      const account = isUuid(accountId)
        ? await tx.accounts.findById(organizationId, accountId)
        : null
      if (account === null) throw new DomainError('NOT_FOUND', 'Account non trovato')
      if (!account.active)
        throw new DomainError(
          'CONFLICT',
          'L’account non è più attivo su Meta: ricollegalo prima di assegnarlo a uno spazio',
        )
      if (await tx.workspaceAccounts.assign(organizationId, created.id, account.id))
        await recordAssignment(tx, current, 'account.assigned', created.id, account.id, request.ip)
    }
    return created
  })
}

/** One account into or out of a workspace, in the activity log. */
export function recordAssignment(
  tx: Tx,
  actor: OrgActor,
  action: 'account.assigned' | 'account.unassigned',
  workspaceId: string,
  accountId: string,
  ip: string | null,
) {
  return tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'account',
    entityId: accountId,
    workspaceId,
    ip,
  })
}

/** Archived ones included: they stay readable. A Member sees only their own, with their role. */
export async function listWorkspaces(
  deps: Pick<WorkspacesDeps, 'uow'>,
  actor: OrgActor,
): Promise<WorkspaceDto[]> {
  const { organizationId } = actor
  const records = await deps.uow.run({ organizationId, userId: actor.userId }, (tx) =>
    tx.workspaces.listVisible(actor),
  )
  return records.flatMap((r) => {
    const role = myRole(actor, r.id)
    return role === undefined ? [] : [toDto(r, role)]
  })
}

/** Runs `change` on a workspace that Owner or Admin may modify; archived ones refuse. */
async function changeWorkspace<T>(
  deps: Pick<WorkspacesDeps, 'uow'>,
  actor: OrgActor,
  workspaceId: string,
  change: (tx: Tx, current: OrgActor, workspace: WorkspaceRecord) => Promise<T>,
): Promise<T> {
  if (!managesWorkspaces(actor)) throw cannotManage()
  if (!isUuid(workspaceId)) throw workspaceNotFound()
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const fresh = await currentActor(tx, actor)
    if (!managesWorkspaces(fresh)) throw cannotManage()
    await assertActiveOrganization(tx, organizationId)
    const { workspace, actor: current } = await lockVisibleWorkspace(tx, fresh, workspaceId)
    return change(tx, current, workspace)
  })
}

/** The slug stays: links depend on it. The same name again changes and records nothing. */
export async function renameWorkspace(
  deps: Pick<WorkspacesDeps, 'uow'>,
  actor: OrgActor,
  workspaceId: string,
  input: { name: string },
  request: { ip: string | null },
): Promise<WorkspaceDto> {
  // the permission comes first, as in createWorkspace
  if (!managesWorkspaces(actor)) throw cannotManage()
  const name = validName(input.name)
  return await changeWorkspace(deps, actor, workspaceId, async (tx, current, workspace) => {
    if (workspace.archivedAt !== null) throw archivedConflict()
    const role = current.orgRole === 'owner' ? 'owner' : 'admin'
    if (workspace.name === name) return toDto(workspace, role)
    await tx.workspaces.rename(current.organizationId, workspaceId, name)
    await recordWorkspace(tx, current, 'workspace.renamed', workspaceId, request.ip)
    return toDto({ ...workspace, name }, role)
  })
}

/**
 * Archived: readable, no longer changeable, and out of the `workspaces` limit. Members keep
 * their roles. A repeat changes and records nothing.
 */
export async function archiveWorkspace(
  deps: Pick<WorkspacesDeps, 'uow' | 'clock'>,
  actor: OrgActor,
  workspaceId: string,
  request: { ip: string | null },
): Promise<void> {
  await changeWorkspace(deps, actor, workspaceId, async (tx, current) => {
    if (!(await tx.workspaces.archive(current.organizationId, workspaceId, deps.clock.now())))
      return
    await recordWorkspace(tx, current, 'workspace.archived', workspaceId, request.ip)
  })
}
