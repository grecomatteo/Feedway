import {
  availableSlug,
  checkPassword,
  DomainError,
  validateNickname,
  type OrgRole,
} from '@app/domain'
import type { InvitePurpose, InviteRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'
import { DEFAULT_ORGANIZATION_NAME } from './bootstrap.js'
import type { IdentityDeps } from './identity-deps.js'

// Better Auth writes users and sessions with its own connection, outside our transactions: each
// step below commits on its own and a retry with the same link picks up where the last one
// stopped (plan, Task 12; proposal §2.3).

export const NAME_MAX_LENGTH = 100
/** `settings` key: the agency created with the platform (the privacy notice names it, Task 30). */
export const FIRST_ORGANIZATION_SETTING = 'platform.first_organization_id'

const linkInvalid = () =>
  new DomainError('LINK_INVALID', 'Il link non è valido o è scaduto: chiedine uno nuovo')
const signInFirst = () =>
  new DomainError('UNAUTHENTICATED', 'Accedi con il tuo account per accettare l’invito')

export interface LinkDescription {
  purpose: InvitePurpose
  email: string
  organizationName: string | null
  /** The page asks to sign in instead of showing the name and password form. */
  existingUser: boolean
}

export interface ActivationInput {
  token: string
  name: string
  nickname: string | null
  /** null: the person registers a passkey next. */
  password: string | null
  ip: string | null
  userAgent: string | null
  /** The person signed in on this browser, if any. */
  sessionUserId: string | null
}

export interface ActivationResult {
  setCookie: string[]
  organizationSlug: string
  next: 'done' | 'register_passkey'
}

/** Whoever already has the invited email, when the invite is not for a new person. */
async function existingAccountFor(tx: Tx, invite: InviteRecord): Promise<string | null> {
  if (invite.existingUserId !== null) return invite.existingUserId
  // someone who registered after the invite was sent has an id other than the reserved one
  const owner = await tx.users.findByEmail(invite.email)
  return owner !== null && owner.id !== invite.reservedUserId ? owner.id : null
}

export async function describeLink(
  deps: Pick<IdentityDeps, 'uow' | 'clock' | 'tokens'>,
  input: { token: string },
): Promise<LinkDescription> {
  return deps.uow.runAsSystem('describe an activation link', async (tx) => {
    const invite = await tx.invites.findValid(deps.tokens.hash(input.token), deps.clock.now())
    if (!invite) throw linkInvalid()
    const organization =
      invite.organizationId === null ? null : await tx.organizations.findById(invite.organizationId)
    return {
      purpose: invite.purpose,
      email: invite.email,
      organizationName: organization?.name ?? null,
      existingUser: (await existingAccountFor(tx, invite)) !== null,
    }
  })
}

type Claim =
  | { kind: 'existing'; userId: string; email: string }
  | { kind: 'new'; userId: string; email: string }

/** Step 1: decides who accepts and, for a new person, fixes their id before anything else. */
async function claim(
  deps: IdentityDeps,
  input: ActivationInput,
  tokenHash: Buffer,
): Promise<Claim> {
  return deps.uow.runAsSystem('activation: claim the invite', async (tx) => {
    const invite = await tx.invites.lockForActivation(tokenHash, deps.clock.now())
    if (!invite) throw linkInvalid()

    const existing = await existingAccountFor(tx, invite)
    if (existing !== null) {
      // credentials, name and nickname of an existing account are never touched by an invite
      if (input.sessionUserId !== existing) throw signInFirst()
      return { kind: 'existing', userId: existing, email: invite.email }
    }

    const name = input.name.trim()
    if (name === '' || Array.from(name).length > NAME_MAX_LENGTH)
      throw new DomainError('VALIDATION', 'Scrivi nome e cognome (al massimo 100 caratteri)', {
        field: 'name',
      })
    if (!validateNickname(input.nickname).ok)
      throw new DomainError('VALIDATION', 'Il soprannome è troppo lungo', { field: 'nickname' })
    if (input.password !== null) {
      const check = checkPassword(
        input.password,
        { email: invite.email, name },
        deps.passwordStrength,
      )
      if (!check.ok)
        throw new DomainError('VALIDATION', 'La password non è abbastanza robusta', {
          field: 'password',
          reason: check.reason,
        })
    }

    if (invite.reservedUserId === null) {
      const userId = deps.ids.newId()
      await tx.invites.reserveUserId(invite.id, userId)
      return { kind: 'new', userId, email: invite.email }
    }
    return { kind: 'new', userId: invite.reservedUserId, email: invite.email }
  })
}

/**
 * A previous attempt already created the reserved account: carry on only if nobody has used it
 * since. Once the activation opened a session (passkey path, link still open), only that session
 * may continue: the link alone must not hand over a live account.
 */
async function checkResume(tx: Tx, invite: InviteRecord, userId: string, input: ActivationInput) {
  const user = await tx.users.findById(userId)
  if (!user) return
  if (user.status !== 'active' || user.anonymizedAt !== null)
    throw new DomainError('CONFLICT', 'Questo account non è attivo')
  const passkeys = await tx.users.countPasskeys(userId)
  const elsewhere = (await tx.orgMembers.listForUser(userId)).some(
    (m) => m.organizationId !== invite.organizationId,
  )
  if (passkeys > 0 || elsewhere)
    throw new DomainError('CONFLICT', 'Questo account è già attivo: accedi')
  if (user.lastLoginAt !== null && input.sessionUserId !== userId) throw signInFirst()
}

/**
 * Steps 2 and 3 under the invite lock: a concurrent attempt fails at once (CONFLICT) and never
 * reaches the credentials. Better Auth writes users and accounts with its own connection, which
 * never waits on the invite row.
 */
async function grant(
  deps: IdentityDeps,
  input: ActivationInput,
  tokenHash: Buffer,
  who: Claim,
): Promise<{ slug: string; linkUsed: boolean }> {
  return deps.uow.runAsSystem('activation: memberships', async (tx) => {
    const now = deps.clock.now()
    const invite = await tx.invites.lockForActivation(tokenHash, now)
    if (!invite) throw linkInvalid()
    const role = roleOf(invite)

    // checked before the account exists: a refused bootstrap leaves nothing behind
    if (
      invite.purpose === 'bootstrap' &&
      (await tx.users.platformAdminExists()) &&
      !(await isPlatformAdmin(tx, who.userId))
    )
      throw new DomainError('CONFLICT', 'Account principale già creato')

    // checked before the account exists: one Owner per agency, and a refused link leaves no
    // account without an agency behind
    if (invite.purpose === 'organization_owner' && invite.organizationId !== null) {
      const owner = (await tx.orgMembers.listForOrganization(invite.organizationId)).find(
        (m) => m.role === 'owner',
      )
      if (owner && owner.userId !== who.userId)
        throw new DomainError('CONFLICT', 'Questa agenzia ha già un Owner')
    }

    if (who.kind === 'new') {
      if (invite.reservedUserId !== who.userId) throw linkInvalid()
      await checkResume(tx, invite, who.userId, input)
      // Step 2: the account with the reserved id; a retry only replaces the password.
      await deps.auth.createUser({
        id: who.userId,
        email: who.email,
        name: input.name.trim(),
        password: input.password,
      })
    }

    let organizationId = invite.organizationId
    if (invite.purpose === 'bootstrap') {
      await tx.users.setPlatformAdmin(who.userId)
      if (organizationId === null) {
        organizationId = deps.ids.newId()
        const name = deps.config.bootstrapOrganizationName.trim() || DEFAULT_ORGANIZATION_NAME
        const slug = await availableSlug(name, (s) => tx.organizations.slugExists(s))
        await tx.organizations.create({ id: organizationId, name, slug })
        await deps.keyRing.createOrganizationKey(tx, organizationId)
        await tx.invites.setOrganization(invite.id, organizationId)
        await tx.platformSettings.set(FIRST_ORGANIZATION_SETTING, organizationId, who.userId)
      }
    }
    if (organizationId === null) throw new Error('an invite other than bootstrap has no agency')

    const current = await tx.orgMembers.find(organizationId, who.userId)
    if (current && who.kind === 'existing')
      throw new DomainError('CONFLICT', 'Fai già parte di questa agenzia')
    if (!current) {
      await tx.orgMembers.addIfMissing({ organizationId, userId: who.userId, role })
      // recorded with the membership: a retry finds it and does not record again
      await recordActivated(tx, invite, organizationId, who.userId, input.ip)
    }
    for (const m of invite.memberships) {
      // archived since the invite: readable, closed to new members (Task 17)
      const workspace = await tx.workspaces.findForShare(organizationId, m.workspaceId)
      if (!workspace || workspace.archivedAt !== null) continue
      await tx.workspaceMembers.addIfMissing({
        organizationId,
        workspaceId: m.workspaceId,
        userId: who.userId,
        role: m.role,
      })
    }

    if (who.kind === 'new') {
      const nickname = validateNickname(input.nickname)
      if (nickname.ok) await tx.users.setNickname(who.userId, nickname.value)
    }
    // with a passkey the link stays open until one is registered (completeActivation)
    const linkUsed = who.kind === 'existing' || input.password !== null
    if (linkUsed) await tx.invites.markUsed(invite.id, now)

    const organization = await tx.organizations.findById(organizationId)
    if (!organization) throw new Error('the agency of the invite is gone')
    return { slug: organization.slug, linkUsed }
  })
}

async function isPlatformAdmin(tx: Tx, userId: string): Promise<boolean> {
  return (await tx.users.findById(userId))?.platformRole === 'admin'
}

/** Once per activation: when the person joins the agency. */
function recordActivated(
  tx: Tx,
  invite: InviteRecord,
  organizationId: string,
  userId: string,
  ip: string | null,
) {
  return tx.audit.record({
    organizationId,
    actorId: userId,
    source: 'panel',
    action: 'user.activated',
    entity: 'user',
    entityId: userId,
    workspaceId: null,
    ip,
    data: { purpose: invite.purpose, role: roleOf(invite) },
  })
}

function roleOf(invite: InviteRecord): OrgRole {
  if (invite.purpose !== 'invite') return 'owner'
  if (invite.orgRole === null) throw new Error('an invite without a role')
  return invite.orgRole
}

export async function activateAccount(
  deps: IdentityDeps,
  input: ActivationInput,
): Promise<ActivationResult> {
  const tokenHash = deps.tokens.hash(input.token)
  const who = await claim(deps, input, tokenHash)
  const { slug, linkUsed } = await grant(deps, input, tokenHash, who)

  // Step 4: an existing account keeps the session it signed in with.
  if (who.kind === 'existing') return { setCookie: [], organizationSlug: slug, next: 'done' }
  const { setCookie } = await deps.auth.openSession(who.userId, {
    ip: input.ip,
    userAgent: input.userAgent,
    authMethod: 'activation',
  })
  // From now on a retry with the open link needs this session (checkResume).
  await deps.uow.run({ userId: who.userId }, (tx) =>
    tx.users.setLastLoginAt(who.userId, deps.clock.now()),
  )
  return { setCookie, organizationSlug: slug, next: linkUsed ? 'done' : 'register_passkey' }
}

/** After the passkey of a new account is registered: the link is used from now on. */
export async function completeActivation(
  deps: Pick<IdentityDeps, 'uow' | 'clock' | 'tokens'>,
  input: { token: string; userId: string },
): Promise<void> {
  await deps.uow.runAsSystem('activation: complete with a passkey', async (tx) => {
    const now = deps.clock.now()
    const invite = await tx.invites.lockForActivation(deps.tokens.hash(input.token), now)
    if (!invite) throw linkInvalid()
    if (invite.reservedUserId !== input.userId) throw signInFirst()
    if ((await tx.users.countPasskeys(input.userId)) === 0)
      throw new DomainError('CONFLICT', 'Registra prima una passkey')
    await tx.invites.markUsed(invite.id, now)
  })
}
