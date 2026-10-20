import {
  can,
  checkLimit,
  DomainError,
  LINK_TTL_MS,
  normalizeEmail,
  parseLimits,
  WORKSPACE_ROLES,
  type OrgActor,
  type WorkspaceRole,
} from '@app/domain'
import type { AuthSessionInfo } from '../ports/auth.js'
import { activationUrl, type IdentityDeps } from './identity-deps.js'
import { assertActorSession, assertOneOf, isUuid } from './member-rules.js'
import { assertRecentReauth } from './reauth.js'

export interface InviteInput {
  email: string
  orgRole: 'member' | 'admin'
  memberships: { workspaceId: string; role: WorkspaceRole }[]
}

const forbidden = (message = 'Non hai i permessi per questo invito') =>
  new DomainError('FORBIDDEN', message)
const workspaceNotFound = () => new DomainError('NOT_FOUND', 'Spazio non trovato')

/**
 * An invite to this agency, as a link to copy from the panel (valid 72 hours). Owner and Admin
 * invite with `users.manage`; a Member only into workspaces where they may manage members, with
 * lower roles, and never without a workspace (spec §10.2). Only the Owner names an Admin, after
 * a reauth. An email that already has an account keeps its credentials: that person accepts
 * after signing in (activation, Task 12).
 */
export async function inviteUser(
  deps: Pick<IdentityDeps, 'uow' | 'clock' | 'ids' | 'tokens' | 'config'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: InviteInput,
  request: { ip: string | null },
): Promise<{ url: string; expiresAt: Date }> {
  assertActorSession(actor, session)
  assertOneOf(input.orgRole, ['member', 'admin'] as const, 'orgRole')
  for (const m of input.memberships) assertOneOf(m.role, WORKSPACE_ROLES, 'memberships')
  const { organizationId } = actor
  const managesUsers = can(actor, 'users.manage', { organizationId })
  if (!managesUsers) {
    // a Member who manages a workspace: only into workspaces, only as a member
    if (input.orgRole !== 'member') throw forbidden()
    if (input.memberships.length === 0)
      throw forbidden('Solo Owner e Admin possono invitare qualcuno senza spazi')
  }
  if (managesUsers && !can(actor, 'users.manage', { organizationId, assignRole: input.orgRole }))
    throw forbidden('Solo l’Owner può nominare un Admin')
  if (input.orgRole === 'admin') assertRecentReauth(session, deps.clock.now())

  const email = normalizeEmail(input.email)
  if (email === null)
    throw new DomainError('VALIDATION', 'Scrivi un indirizzo email valido', { field: 'email' })
  const workspaceIds = input.memberships.map((m) => m.workspaceId)
  if (new Set(workspaceIds).size !== workspaceIds.length)
    throw new DomainError('VALIDATION', 'Ogni spazio va indicato una volta sola', {
      field: 'memberships',
    })

  const { token, hash } = deps.tokens.generate()
  const expiresAt = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    for (const m of input.memberships) {
      // a workspace the actor cannot see, here or in another agency, does not exist for them
      if (!isUuid(m.workspaceId)) throw workspaceNotFound()
      const workspace = await tx.workspaces.findVisibleById(actor, m.workspaceId)
      if (!workspace) throw workspaceNotFound()
      if (workspace.archivedAt !== null) throw new DomainError('CONFLICT', 'Lo spazio è archiviato')
      if (
        !can(actor, 'workspace.members.manage', {
          organizationId,
          workspaceId: m.workspaceId,
          assignRole: m.role,
        })
      )
        throw forbidden('Non puoi assegnare questo ruolo in questo spazio')
    }

    const existing = await tx.users.findByEmail(email)
    if (existing) {
      const membership = await tx.orgMembers.find(organizationId, existing.id)
      if (membership?.status === 'disabled')
        throw new DomainError('CONFLICT', 'È nell’agenzia ma disattivato: riattivalo')
      if (membership)
        throw new DomainError('CONFLICT', 'È già nell’agenzia: aggiungilo allo spazio')
    }

    const now = deps.clock.now()
    // members (disabled ones too) and open invites each hold a seat
    await tx.orgMembers.lockSeats(organizationId)
    const organization = await tx.organizations.findById(organizationId)
    if (!organization) throw new DomainError('NOT_FOUND', 'Agenzia non trovata')
    const used =
      (await tx.orgMembers.count(organizationId)) +
      (await tx.invites.countOpen(organizationId, now))
    const check = checkLimit(parseLimits(organization.limits), 'users', used)
    if (!check.ok)
      throw new DomainError('LIMIT_REACHED', 'L’agenzia ha raggiunto il numero massimo di utenti', {
        limit: check.limit,
      })

    const id = deps.ids.newId()
    const expires = new Date(now.getTime() + LINK_TTL_MS.invite)
    await tx.invites.create({
      id,
      organizationId,
      purpose: 'invite',
      email,
      existingUserId: existing?.id ?? null,
      tokenHash: hash,
      invitedBy: actor.userId,
      orgRole: input.orgRole,
      memberships: input.memberships.map((m) => ({ workspaceId: m.workspaceId, role: m.role })),
      expiresAt: expires,
    })
    await tx.audit.record({
      organizationId,
      actorId: actor.userId,
      source: 'panel',
      action: 'user.invited',
      entity: 'invite',
      entityId: id,
      workspaceId: null,
      ip: request.ip,
      data: {
        orgRole: input.orgRole,
        // not whether the email has an account: that would tell this agency about others
        memberships: input.memberships.map((m) => ({ workspaceId: m.workspaceId, role: m.role })),
      },
    })
    return expires
  })
  return { url: activationUrl(deps.config.panelUrl, token), expiresAt }
}
