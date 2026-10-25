import {
  avatarUrl,
  can,
  displayName,
  DomainError,
  seesAllWorkspaces,
  WORKSPACE_ROLES,
  type OrgActor,
  type WorkspaceRole,
} from '@app/domain'
import { assertActorSession, assertOneOf, assertRecentReauth, isUuid } from '../identity/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { AuditAction } from '../ports/audit-log.js'
import type { OrgMemberRecord, WorkspaceRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'
import {
  assertActiveOrganization,
  currentActor,
  lockVisibleWorkspace,
  workspaceNotFound,
  type WorkspacesDeps,
} from './workspaces.js'

// Adding, changing or removing a workspace role is a privilege change: it signs the person out
// everywhere (spec §10.3, §15.2), as in the agency's user list (Task 15): inside the
// transaction, before it commits, and again after the commit for a sign-in that landed in
// between. Nothing changed, nobody signed out: sessions are platform-wide.

export interface WorkspaceMemberDto {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: WorkspaceRole
  /**
   * Disabled in this agency, or on the whole platform, or anonymized (as in `listMembers`).
   * Only those who manage the workspace's members get disabled rows.
   */
  status: 'active' | 'disabled'
}

export interface WorkspaceMemberInput {
  workspaceId: string
  userId: string
  role: WorkspaceRole
}

// one answer for "not in the agency" and "not in this workspace": a Manager must not learn
// who works for the agency by probing ids
const memberNotFound = () => new DomainError('NOT_FOUND', 'Utente non trovato')
const notInWorkspace = memberNotFound
const cannotManageMembers = () =>
  new DomainError('FORBIDDEN', 'Non hai i permessi per gestire i membri di questo spazio')
const cannotTouch = () =>
  new DomainError('FORBIDDEN', 'Non puoi assegnare questo ruolo o modificare questo membro')
const archivedConflict = () =>
  new DomainError('CONFLICT', 'Lo spazio è archiviato: non si può modificare')

/**
 * Everyone in the workspace sees who works in it (decision of Matteo, 2026-10-25): Owner and
 * Admin, and every role of that workspace. A workspace the actor does not see is not found.
 * Only those who manage its members also see the disabled ones, with their status.
 */
export async function listWorkspaceMembers(
  deps: Pick<WorkspacesDeps, 'uow'>,
  actor: OrgActor,
  workspaceId: string,
): Promise<WorkspaceMemberDto[]> {
  if (!isUuid(workspaceId)) throw workspaceNotFound()
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    // visibility depends on the actor's workspace roles: read them as the database has them now
    const current = await currentActor(tx, actor)
    await assertActiveOrganization(tx, organizationId)
    const workspace = await tx.workspaces.findVisibleById(current, workspaceId)
    if (!workspace || (!seesAllWorkspaces(current) && !current.memberships.has(workspaceId)))
      throw workspaceNotFound()
    const manages = can(current, 'workspace.members.manage', { organizationId, workspaceId })
    const members = await tx.workspaceMembers.listForWorkspace(organizationId, workspaceId)
    const agency = new Map(
      (await tx.orgMembers.listForOrganization(organizationId)).map((m) => [m.userId, m.status]),
    )
    // ids read under the agency's row level security: only its own people
    const people = new Map(
      (await tx.users.summaries(members.map((m) => m.userId))).map((u) => [u.id, u]),
    )
    return members.flatMap((m) => {
      const user = people.get(m.userId)
      if (!user) return []
      const status =
        agency.get(m.userId) === 'active' && user.status === 'active' && user.anonymizedAt === null
          ? ('active' as const)
          : ('disabled' as const)
      if (status === 'disabled' && !manages) return []
      return [
        {
          userId: m.userId,
          displayName: displayName(user),
          avatarUrl: avatarUrl(user.id, user.avatarKey),
          role: m.role,
          status,
        },
      ]
    })
  })
}

interface Target {
  member: OrgMemberRecord
  /** The current role in this workspace, locked until the transaction ends. */
  role: WorkspaceRole | null
}

interface Scope {
  tx: Tx
  actor: OrgActor
  workspace: WorkspaceRecord
  target: Target
}

/**
 * Opens the agency's transaction, re-reads the actor, locks the workspace and the target, and
 * checks that the actor manages this workspace's members. `change` returns who to sign out.
 */
async function changeMember(
  deps: Pick<WorkspacesDeps, 'uow' | 'auth'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  ids: { workspaceId: string; userId: string },
  change: (scope: Scope) => Promise<readonly string[]>,
): Promise<void> {
  assertActorSession(actor, session)
  if (!isUuid(ids.workspaceId)) throw workspaceNotFound()
  const { organizationId } = actor
  const signOut = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const fresh = await currentActor(tx, actor)
    await assertActiveOrganization(tx, organizationId)
    const { workspace, actor: current } = await lockVisibleWorkspace(tx, fresh, ids.workspaceId)
    if (!can(current, 'workspace.members.manage', { organizationId, workspaceId: workspace.id }))
      throw cannotManageMembers()
    // a malformed id is a missing member, not a database error
    if (!isUuid(ids.userId)) throw memberNotFound()
    const member = await tx.orgMembers.findForUpdate(organizationId, ids.userId)
    if (!member) throw memberNotFound()
    const role = await tx.workspaceMembers.findForUpdate(organizationId, workspace.id, ids.userId)
    const people = await change({ tx, actor: current, workspace, target: { member, role } })
    for (const userId of people) await deps.auth.revokeAllSessions(userId)
    return people
  })
  for (const userId of signOut) await deps.auth.revokeAllSessions(userId)
}

/** Whether `can()` lets the actor act on this target, handing out `assignRole` if given. */
function mayActOn(scope: Scope, assignRole?: WorkspaceRole): boolean {
  const { actor, workspace, target } = scope
  return can(actor, 'workspace.members.manage', {
    organizationId: actor.organizationId,
    workspaceId: workspace.id,
    targetUser: {
      id: target.member.userId,
      orgRole: target.member.role,
      ...(target.role === null ? {} : { workspaceRole: target.role }),
    },
    ...(assignRole === undefined ? {} : { assignRole }),
  })
}

function record(
  scope: Scope,
  action: AuditAction,
  ip: string | null,
  data: Record<string, unknown>,
) {
  const { tx, actor, workspace, target } = scope
  return tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'user',
    entityId: target.member.userId,
    workspaceId: workspace.id,
    ip,
    data,
  })
}

/**
 * Gives a role in the workspace to an active member of the agency. Someone outside the agency,
 * here or in another, is not found. The same role again changes nothing; another role goes
 * through `changeWorkspaceMemberRole`, which asks for a reauth.
 */
export async function addWorkspaceMember(
  deps: Pick<WorkspacesDeps, 'uow' | 'auth' | 'clock'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: WorkspaceMemberInput,
  request: { ip: string | null },
): Promise<void> {
  assertOneOf(input.role, WORKSPACE_ROLES, 'role')
  const { role } = input
  await changeMember(deps, actor, session, input, async (scope) => {
    const { tx, actor: current, workspace, target } = scope
    if (workspace.archivedAt !== null) throw archivedConflict()
    if (!mayActOn(scope, role)) throw cannotTouch()
    // a role is a delicate action (spec §15.2): also so that remove-then-add cannot stand in
    // for a role change without reauth
    assertRecentReauth(session, deps.clock.now())
    if (target.role === role) return []
    if (target.role !== null)
      throw new DomainError('CONFLICT', 'Ha già un ruolo in questo spazio: cambialo da lì')
    if (target.member.status !== 'active')
      throw new DomainError('CONFLICT', 'È nell’agenzia ma disattivato: riattivalo prima')
    const [person] = await tx.users.summaries([target.member.userId])
    if (!person || person.status !== 'active' || person.anonymizedAt !== null)
      throw new DomainError('CONFLICT', 'L’account di questa persona non è attivo')
    const added = await tx.workspaceMembers.add({
      organizationId: current.organizationId,
      workspaceId: workspace.id,
      userId: target.member.userId,
      role,
    })
    if (!added) throw new DomainError('CONFLICT', 'Il ruolo è appena cambiato: ricarica e riprova')
    await record(scope, 'member.added', request.ip, { role })
    return [target.member.userId]
  })
}

/** With a recent reauth (spec §15.2); signs the person out. */
export async function changeWorkspaceMemberRole(
  deps: Pick<WorkspacesDeps, 'uow' | 'auth' | 'clock'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: WorkspaceMemberInput,
  request: { ip: string | null },
): Promise<void> {
  assertOneOf(input.role, WORKSPACE_ROLES, 'role')
  const { role } = input
  await changeMember(deps, actor, session, input, async (scope) => {
    const { tx, actor: current, workspace, target } = scope
    if (workspace.archivedAt !== null) throw archivedConflict()
    if (target.role === null) throw notInWorkspace()
    if (!mayActOn(scope, role)) throw cannotTouch()
    assertRecentReauth(session, deps.clock.now())
    if (target.role === role) return []
    if (target.member.status !== 'active')
      throw new DomainError('CONFLICT', 'L’utente è disattivato: riattivalo prima')
    const changed = await tx.workspaceMembers.setRole(
      current.organizationId,
      workspace.id,
      target.member.userId,
      target.role,
      role,
    )
    if (!changed)
      throw new DomainError('CONFLICT', 'Il ruolo è appena cambiato: ricarica e riprova')
    await record(scope, 'member.role_changed', request.ip, { from: target.role, to: role })
    return [target.member.userId]
  })
}

/**
 * Takes the person out of the workspace and signs them out. Allowed in an archived workspace
 * too: it stays readable, and this is how someone's access to it ends.
 */
export async function removeWorkspaceMember(
  deps: Pick<WorkspacesDeps, 'uow' | 'auth'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: { workspaceId: string; userId: string },
  request: { ip: string | null },
): Promise<void> {
  await changeMember(deps, actor, session, input, async (scope) => {
    const { tx, actor: current, workspace, target } = scope
    if (target.role === null) throw notInWorkspace()
    if (!mayActOn(scope)) throw cannotTouch()
    // spec §10.2: a Member without workspaces is made only by Owner and Admin. The target's
    // agency row is locked (changeMember), so two removals of the same person go one at a time.
    if (
      target.member.role === 'member' &&
      !seesAllWorkspaces(current) &&
      (await tx.workspaceMembers.countInActiveWorkspaces(
        current.organizationId,
        target.member.userId,
        workspace.id,
      )) === 0
    )
      throw new DomainError(
        'CONFLICT',
        'Resterebbe senza spazi: solo Owner e Admin possono toglierle l’ultimo spazio',
      )
    if (
      !(await tx.workspaceMembers.remove(
        current.organizationId,
        workspace.id,
        target.member.userId,
      ))
    )
      throw notInWorkspace()
    await record(scope, 'member.removed', request.ip, { role: target.role })
    return [target.member.userId]
  })
}
