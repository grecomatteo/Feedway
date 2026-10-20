import {
  avatarUrl,
  can,
  displayName,
  DomainError,
  type OrgActor,
  type OrgRole,
  type WorkspaceRole,
} from '@app/domain'
import type { Auth, AuthSessionInfo } from '../ports/auth.js'
import type { AuditAction } from '../ports/audit-log.js'
import type { Tx } from '../ports/tx.js'
import type { IdentityDeps } from './identity-deps.js'
import {
  assertActorSession,
  assertManagesUsers,
  assertOneOf,
  targetMember,
} from './member-rules.js'
import { assertRecentReauth } from './reauth.js'

// A change of role or status signs the person out everywhere (spec §10.3, §15.2): the next
// sign-in gets a new token. Sessions are revoked inside the transaction, before it commits (if
// that fails nothing changes), and again after the commit, for a sign-in that landed in between.
// Requests read memberships afresh anyway (resolveOrgActor). Sessions are platform-wide: nothing
// is revoked when nothing changed, or a repeat would sign the person out of other agencies too.

/** A person in the agency's user list: no hash, token or secret, only whether a factor exists. */
export interface MemberDto {
  id: string
  displayName: string
  name: string
  nickname: string | null
  email: string
  avatarUrl: string | null
  orgRole: OrgRole
  /** Disabled in this agency, or on the whole platform. */
  status: 'active' | 'disabled'
  secondFactorConfigured: boolean
  workspaces: { id: string; name: string; role: WorkspaceRole }[]
  lastLoginAt: Date | null
}

export async function listMembers(
  deps: Pick<IdentityDeps, 'uow'>,
  actor: OrgActor,
): Promise<MemberDto[]> {
  assertManagesUsers(actor)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    // row level security and the filter both keep this to the agency's own members
    const members = await tx.orgMembers.listForOrganization(organizationId)
    const people = new Map(
      (await tx.users.summaries(members.map((m) => m.userId))).map((u) => [u.id, u]),
    )
    const workspaces = await tx.workspaceMembers.listForOrganization(organizationId)
    return members.flatMap((m) => {
      const user = people.get(m.userId)
      if (!user) return []
      return [
        {
          id: user.id,
          displayName: displayName(user),
          name: user.name,
          nickname: user.nickname,
          email: user.email,
          avatarUrl: avatarUrl(user.id, user.avatarKey),
          orgRole: m.role,
          status:
            m.status === 'active' && user.status === 'active' && user.anonymizedAt === null
              ? 'active'
              : 'disabled',
          secondFactorConfigured: user.twoFactorEnabled || user.passkeys > 0,
          workspaces: workspaces
            .filter((w) => w.userId === m.userId)
            .map((w) => ({ id: w.workspaceId, name: w.workspaceName, role: w.role })),
          lastLoginAt: user.lastLoginAt,
        },
      ]
    })
  })
}

function record(
  tx: Tx,
  actor: OrgActor,
  action: AuditAction,
  userId: string,
  ip: string | null,
  data?: Record<string, unknown>,
) {
  return tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'user',
    entityId: userId,
    workspaceId: null,
    ip,
    ...(data === undefined ? {} : { data }),
  })
}

type RevokingDeps = Pick<IdentityDeps, 'uow' | 'clock'> & { auth: Pick<Auth, 'revokeAllSessions'> }

/** Runs `change` in the agency; when it says something changed, signs these people out. */
async function changeAndRevoke(
  deps: RevokingDeps,
  actor: OrgActor,
  change: (tx: Tx) => Promise<readonly string[]>,
): Promise<void> {
  const { organizationId } = actor
  const signOut = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const people = await change(tx)
    for (const userId of people) await deps.auth.revokeAllSessions(userId)
    return people
  })
  for (const userId of signOut) await deps.auth.revokeAllSessions(userId)
}

async function setMemberStatus(
  deps: RevokingDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  userId: string,
  status: 'active' | 'disabled',
  request: { ip: string | null },
): Promise<void> {
  assertActorSession(actor, session)
  assertManagesUsers(actor)
  // giving access back is sensitive (a stolen session could reopen a locked-out account);
  // taking it away is the emergency action and needs no reauth
  if (status === 'active') assertRecentReauth(session, deps.clock.now())
  const { organizationId } = actor
  await changeAndRevoke(deps, actor, async (tx) => {
    await targetMember(tx, actor, userId)
    // already in that state: nothing to record and nobody to sign out
    if (!(await tx.orgMembers.setStatus(organizationId, userId, status))) return []
    await record(
      tx,
      actor,
      status === 'disabled' ? 'user.disabled' : 'user.enabled',
      userId,
      request.ip,
    )
    return [userId]
  })
}

/** The person loses this agency only (spec §10.4); the Owner never. */
export function disableMember(
  deps: RevokingDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  userId: string,
  request: { ip: string | null },
): Promise<void> {
  return setMemberStatus(deps, actor, session, userId, 'disabled', request)
}

export function enableMember(
  deps: RevokingDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  userId: string,
  request: { ip: string | null },
): Promise<void> {
  return setMemberStatus(deps, actor, session, userId, 'active', request)
}

const onlyOwner = (message: string) => new DomainError('FORBIDDEN', message)

/** Only the Owner names or demotes an Admin, with a recent reauth. */
export async function changeOrgRole(
  deps: RevokingDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  userId: string,
  role: 'admin' | 'member',
  request: { ip: string | null },
): Promise<void> {
  assertActorSession(actor, session)
  assertOneOf(role, ['admin', 'member'] as const, 'role')
  if (actor.orgRole !== 'owner') throw onlyOwner('Solo l’Owner può cambiare il ruolo')
  if (!can(actor, 'users.manage', { organizationId: actor.organizationId, assignRole: role }))
    throw onlyOwner('Solo l’Owner può cambiare il ruolo')
  assertRecentReauth(session, deps.clock.now())
  const { organizationId } = actor
  await changeAndRevoke(deps, actor, async (tx) => {
    const member = await targetMember(tx, actor, userId)
    if (member.role === role) return []
    if (member.status !== 'active')
      throw new DomainError('CONFLICT', 'L’utente è disattivato: riattivalo prima')
    if (!(await tx.orgMembers.setRole(organizationId, userId, member.role, role)))
      throw new DomainError('CONFLICT', 'Il ruolo è appena cambiato: ricarica e riprova')
    await record(tx, actor, 'user.role_changed', userId, request.ip, {
      from: member.role,
      to: role,
    })
    return [userId]
  })
}

/**
 * The Owner hands the agency to an active Admin who has a second factor, and becomes Admin
 * (spec §10.4). One transaction: the old Owner steps down first, because the "one owner" index
 * would refuse the other order; any failure leaves both roles as they were.
 */
export async function transferOwnership(
  deps: RevokingDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  newOwnerUserId: string,
  request: { ip: string | null },
): Promise<void> {
  assertActorSession(actor, session)
  if (actor.orgRole !== 'owner') throw onlyOwner('Solo l’Owner può passare la proprietà')
  assertRecentReauth(session, deps.clock.now())
  const { organizationId } = actor
  await changeAndRevoke(deps, actor, async (tx) => {
    const target = await targetMember(tx, actor, newOwnerUserId)
    if (target.userId === actor.userId || target.role !== 'admin' || target.status !== 'active')
      throw new DomainError('FORBIDDEN', 'La proprietà passa solo a un Admin attivo dell’agenzia')
    const [person] = await tx.users.summaries([newOwnerUserId])
    if (!person || person.status !== 'active' || person.anonymizedAt !== null)
      throw new DomainError('FORBIDDEN', 'La proprietà passa solo a un Admin attivo dell’agenzia')
    if (!person.twoFactorEnabled && person.passkeys === 0)
      throw new DomainError(
        'CONFLICT',
        'Il nuovo Owner deve prima configurare una passkey o l’app di autenticazione',
      )
    // compare-and-set on role and status: a change since the actor was resolved stops here
    if (!(await tx.orgMembers.setRole(organizationId, actor.userId, 'owner', 'admin')))
      throw new DomainError('CONFLICT', 'La proprietà è appena cambiata: ricarica e riprova')
    if (!(await tx.orgMembers.setRole(organizationId, newOwnerUserId, 'admin', 'owner')))
      throw new DomainError('CONFLICT', 'Il ruolo è appena cambiato: ricarica e riprova')
    await tx.audit.record({
      organizationId,
      actorId: actor.userId,
      source: 'panel',
      action: 'organization.ownership_transferred',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: request.ip,
      data: { from: actor.userId, to: newOwnerUserId },
    })
    return [newOwnerUserId, actor.userId]
  })
}
