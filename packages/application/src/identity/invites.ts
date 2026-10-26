import {
  can,
  checkLimit,
  displayName,
  DomainError,
  LINK_TTL_MS,
  normalizeEmail,
  parseLimits,
  WORKSPACE_ROLES,
  type OrgActor,
  type OrgRole,
  type WorkspaceRole,
} from '@app/domain'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer } from '../ports/mailer.js'
import type { InviteRecord } from '../ports/repositories.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'
import { activationUrl, type IdentityDeps } from './identity-deps.js'
import { assertActorSession, assertOneOf, isUuid } from './member-rules.js'
import { assertRecentReauth } from './reauth.js'
import { emailHtml, formatWhen } from './security-emails.js'

/**
 * Inviting sends the link to the invited mailbox and nowhere else (decision of 26/10): the link
 * proves the person owns the address, and whoever invites can neither use it in their place nor
 * learn from the activation page whether the address already has an account.
 */
export interface InviteDeps extends Pick<
  IdentityDeps,
  'uow' | 'clock' | 'ids' | 'tokens' | 'rateLimiter' | 'config'
> {
  mailer: Mailer
  translate: Translate
  logger: Logger
  productName: string
  /** The expiry is written in this time zone: the invited person may have no account yet. */
  defaultTimezone: string
}

/** Invites to one address, whatever the agency: nobody gets flooded with them. */
export const INVITES_PER_ADDRESS = { limit: 3, windowMs: 24 * 3600_000 }

export interface InviteInput {
  email: string
  orgRole: 'member' | 'admin'
  memberships: { workspaceId: string; role: WorkspaceRole }[]
}

const forbidden = (message = 'Non hai i permessi per questo invito') =>
  new DomainError('FORBIDDEN', message)
const workspaceNotFound = () => new DomainError('NOT_FOUND', 'Spazio non trovato')
const inviteNotFound = () => new DomainError('NOT_FOUND', 'Invito non trovato')
const mailNotConfigured = () =>
  new DomainError('MAIL_NOT_CONFIGURED', 'Configura l’invio delle email per poter invitare')
const mailSendFailed = () =>
  new DomainError('MAIL_SEND_FAILED', 'Non siamo riusciti a inviare l’invito: riprova tra poco')

async function assertMailConfigured(deps: Pick<InviteDeps, 'mailer'>): Promise<void> {
  if (!(await deps.mailer.isConfigured())) throw mailNotConfigured()
}

/**
 * Counted on a hash of the address, never the address itself. A refusal says only that the
 * address got enough invites today, from this agency or another one: the wait is always the
 * whole window, so it tells nothing of when the others were sent.
 */
async function takeAllowance(deps: Pick<InviteDeps, 'rateLimiter' | 'tokens'>, email: string) {
  const key = `invite-email:${deps.tokens.hash(email).toString('hex')}`
  const { limit, windowMs } = INVITES_PER_ADDRESS
  const { allowed } = await deps.rateLimiter.hit(key, limit, windowMs)
  if (!allowed)
    throw new DomainError(
      'RATE_LIMITED',
      'Questo indirizzo ha ricevuto troppi inviti nelle ultime 24 ore: riprova domani',
      { retryAfterSeconds: windowMs / 1000 },
    )
}

/** How the email names whoever invites: their nickname, else their name. */
async function nameOf(tx: Tx, userId: string): Promise<string> {
  const [user] = await tx.users.summaries([userId])
  return user ? displayName(user) : ''
}

interface InviteMail {
  inviteId: string
  to: string
  token: string
  expiresAt: Date
  organizationName: string
  inviter: string
  /** Someone already has this address: they sign in to accept, they create nothing. */
  existingAccount: boolean
}

/** After the commit: the token lives only in this message, never in a queue or a table. */
async function sendInviteMail(
  deps: InviteDeps,
  mail: InviteMail,
): Promise<'sent' | 'not_configured'> {
  const values = {
    product: deps.productName,
    organization: mail.organizationName,
    inviter: mail.inviter,
    url: activationUrl(deps.config.panelUrl, mail.token),
    expires: formatWhen(mail.expiresAt, deps.defaultTimezone),
  }
  const key = `email.invite.${mail.existingAccount ? 'existingAccount' : 'newAccount'}`
  return deps.mailer.send({
    to: mail.to,
    subject: deps.translate(`${key}.subject`, values),
    text: deps.translate(`${key}.text`, values),
    html: emailHtml(deps.translate, `${key}.text`, values, 'url'),
  })
}

/** Never the message of the error: a mail server may echo the address or the link. */
const failureOf = (error: unknown) => (error instanceof Error ? error.name : typeof error)

/**
 * An invite to this agency (valid 72 hours), sent by email to the invited address only. Owner
 * and Admin invite with `users.manage`; a Member only into workspaces where they may manage
 * members, with lower roles, and never without a workspace (spec §10.2). Only the Owner names an
 * Admin, after a reauth. An email that already has an account keeps its credentials: that person
 * accepts after signing in (activation, Task 12). Whoever invites gets the same answer either
 * way, and the email leaves in both cases.
 */
export async function inviteUser(
  deps: InviteDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: InviteInput,
  request: { ip: string | null },
): Promise<{ inviteId: string; expiresAt: Date }> {
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
  await assertMailConfigured(deps)
  await takeAllowance(deps, email)

  const { token, hash } = deps.tokens.generate()
  const mail = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
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
    return {
      inviteId: id,
      to: email,
      token,
      expiresAt: expires,
      organizationName: organization.name,
      inviter: await nameOf(tx, actor.userId),
      existingAccount: existing !== null,
    }
  })

  let result: 'sent' | 'not_configured'
  try {
    result = await sendInviteMail(deps, mail)
  } catch (error) {
    deps.logger.error({ inviteId: mail.inviteId, failure: failureOf(error) }, 'invite email failed')
    await cancelUnsent(deps, actor, mail.inviteId, request)
    throw mailSendFailed()
  }
  if (result === 'not_configured') {
    deps.logger.warn({ inviteId: mail.inviteId }, 'invite email not sent: not_configured')
    await cancelUnsent(deps, actor, mail.inviteId, request)
    throw mailNotConfigured()
  }
  return { inviteId: mail.inviteId, expiresAt: mail.expiresAt }
}

/** A link nobody received must not hold a seat, nor wait for someone who never gets it. */
async function cancelUnsent(
  deps: InviteDeps,
  actor: OrgActor,
  inviteId: string,
  request: { ip: string | null },
): Promise<void> {
  const { organizationId } = actor
  try {
    await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
      await tx.invites.expire(inviteId, deps.clock.now())
      await recordInvite(tx, actor, 'user.invite_revoked', inviteId, request, {
        reason: 'send_failed',
      })
    })
  } catch (error) {
    // the invite stays in the list, where it can be cancelled or sent again
    deps.logger.error({ inviteId, failure: failureOf(error) }, 'unsent invite not cancelled')
  }
}

function recordInvite(
  tx: Tx,
  actor: OrgActor,
  action: 'user.invite_resent' | 'user.invite_revoked',
  inviteId: string,
  request: { ip: string | null },
  data?: Record<string, unknown>,
) {
  return tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'invite',
    entityId: inviteId,
    workspaceId: null,
    ip: request.ip,
    ...(data === undefined ? {} : { data }),
  })
}

/**
 * Who handles an open invite. Owner and Admin: every one of the agency. A Member: only the
 * invites they sent themselves, and only while they may still give every workspace role in them
 * (the strictest reading of `can()`). Like creating one: a workspace the Member has no role in is
 * not found, one they may not manage is forbidden; someone else's invite is not found.
 */
function accessTo(actor: OrgActor, invite: InviteRecord): 'ok' | 'not_found' | 'forbidden' {
  const { organizationId } = actor
  if (can(actor, 'users.manage', { organizationId })) return 'ok'
  if (invite.memberships.length === 0) return 'not_found'
  if (invite.memberships.some((m) => !actor.memberships.has(m.workspaceId))) return 'not_found'
  const manages = invite.memberships.every((m) =>
    can(actor, 'workspace.members.manage', {
      organizationId,
      workspaceId: m.workspaceId,
      assignRole: m.role,
    }),
  )
  if (!manages) return 'forbidden'
  return invite.invitedBy === actor.userId ? 'ok' : 'not_found'
}

async function lockedInvite(
  tx: Tx,
  deps: Pick<InviteDeps, 'clock'>,
  actor: OrgActor,
  inviteId: string,
): Promise<InviteRecord> {
  const invite = await tx.invites.findOpenForUpdate(
    actor.organizationId,
    inviteId,
    deps.clock.now(),
  )
  if (!invite) throw inviteNotFound()
  const access = accessTo(actor, invite)
  if (access === 'not_found') throw inviteNotFound()
  if (access === 'forbidden') throw forbidden()
  return invite
}

/** An open invite as the panel lists it: no token, nor whether the address has an account. */
export interface InviteDto {
  id: string
  email: string
  orgRole: OrgRole
  memberships: { workspaceId: string; role: WorkspaceRole }[]
  /** Nickname, else name, of whoever sent it; null if it is gone. */
  invitedBy: string | null
  expiresAt: Date
}

/** The open invites the actor may handle (see `accessTo`); a Member who manages no workspace may not list them. */
export async function listInvites(
  deps: Pick<InviteDeps, 'uow' | 'clock'>,
  actor: OrgActor,
): Promise<InviteDto[]> {
  const { organizationId } = actor
  const managesSome =
    can(actor, 'users.manage', { organizationId }) ||
    [...actor.memberships.keys()].some((workspaceId) =>
      can(actor, 'workspace.members.manage', { organizationId, workspaceId }),
    )
  if (!managesSome) throw forbidden('Non hai i permessi per vedere gli inviti')
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const open = (await tx.invites.listOpen(organizationId, deps.clock.now())).filter(
      (invite) => accessTo(actor, invite) === 'ok',
    )
    const senders = [...new Set(open.flatMap((i) => (i.invitedBy === null ? [] : [i.invitedBy])))]
    const names = new Map((await tx.users.summaries(senders)).map((u) => [u.id, displayName(u)]))
    return open.map((invite) => ({
      id: invite.id,
      email: invite.email,
      orgRole: invite.orgRole ?? 'member',
      memberships: invite.memberships.map((m) => ({ workspaceId: m.workspaceId, role: m.role })),
      invitedBy: invite.invitedBy === null ? null : (names.get(invite.invitedBy) ?? null),
      expiresAt: invite.expiresAt,
    }))
  })
}

/**
 * A new link for an open invite, by email again: the old link stops working and the 72 hours
 * start over. It counts towards the same allowance per address. Whoever could not create the
 * invite (an Admin invite: the Owner, after a reauth) cannot send it again. If the email then
 * fails, the invite stays open with a link nobody has: it can be sent again or cancelled.
 */
export async function resendInvite(
  deps: InviteDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  inviteId: string,
  request: { ip: string | null },
): Promise<{ inviteId: string; expiresAt: Date }> {
  assertActorSession(actor, session)
  if (!isUuid(inviteId)) throw inviteNotFound()
  await assertMailConfigured(deps)
  const { organizationId } = actor
  const { token, hash } = deps.tokens.generate()
  const mail = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const invite = await lockedInvite(tx, deps, actor, inviteId)
    const orgRole = invite.orgRole ?? 'member'
    if (
      orgRole !== 'member' &&
      !can(actor, 'users.manage', { organizationId, assignRole: orgRole })
    )
      throw forbidden('Solo l’Owner può nominare un Admin')
    if (orgRole === 'admin') assertRecentReauth(session, deps.clock.now())
    await takeAllowance(deps, invite.email)

    const now = deps.clock.now()
    const expires = new Date(now.getTime() + LINK_TTL_MS.invite)
    await tx.invites.replaceToken(invite.id, hash, expires)
    await recordInvite(tx, actor, 'user.invite_resent', invite.id, request)
    const organization = await tx.organizations.findById(organizationId)
    if (!organization) throw new DomainError('NOT_FOUND', 'Agenzia non trovata')
    return {
      inviteId: invite.id,
      to: invite.email,
      token,
      expiresAt: expires,
      organizationName: organization.name,
      inviter: await nameOf(tx, actor.userId),
      existingAccount:
        invite.existingUserId !== null || (await tx.users.findByEmail(invite.email)) !== null,
    }
  })

  let result: 'sent' | 'not_configured'
  try {
    result = await sendInviteMail(deps, mail)
  } catch (error) {
    deps.logger.error({ inviteId: mail.inviteId, failure: failureOf(error) }, 'invite email failed')
    throw mailSendFailed()
  }
  if (result === 'not_configured') {
    deps.logger.warn({ inviteId: mail.inviteId }, 'invite email not sent: not_configured')
    throw mailNotConfigured()
  }
  return { inviteId: mail.inviteId, expiresAt: mail.expiresAt }
}

/** Cancels an open invite: the link stops working at once and the seat is free again. */
export async function revokeInvite(
  deps: Pick<InviteDeps, 'uow' | 'clock'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  inviteId: string,
  request: { ip: string | null },
): Promise<{ revoked: true }> {
  assertActorSession(actor, session)
  if (!isUuid(inviteId)) throw inviteNotFound()
  const { organizationId } = actor
  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const invite = await lockedInvite(tx, deps, actor, inviteId)
    await tx.invites.expire(invite.id, deps.clock.now())
    await recordInvite(tx, actor, 'user.invite_revoked', invite.id, request)
  })
  return { revoked: true }
}
