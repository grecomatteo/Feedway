import { DomainError, normalizeEmail } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Mailer } from '../ports/mailer.js'
import type { Tx } from '../ports/tx.js'
import {
  assertPlatform,
  callerIsSystem,
  NO_REQUEST,
  platformAuthor,
  type PlatformCaller,
  type PlatformDeps,
  type PlatformRequest,
} from './platform-actor.js'

const userNotFound = () => new DomainError('NOT_FOUND', 'Utente non trovato')

type Deps = Pick<PlatformDeps, 'uow' | 'clock'>

/**
 * The recovery link after a "Non sono stato io" lock: shorter than the one-hour reset links, as
 * it reopens an account someone else may have used.
 */
export const ACCOUNT_RECOVERY_LINK_TTL_MS = 30 * 60_000

/** How the platform administrator checked the person's identity before giving the account back. */
export const IDENTITY_VERIFICATION_METHODS = [
  'phone_known_number',
  'in_person',
  'video_call',
] as const

export type IdentityVerificationMethod = (typeof IDENTITY_VERIFICATION_METHODS)[number]

export interface EnableInput {
  /** Required after a "Non sono stato io" lock: never free text, so nothing personal is logged. */
  identityVerification?: { method: IdentityVerificationMethod }
}

/** The Better Auth route that checks the token and opens `/reimposta?token=…`. */
const passwordResetLinkUrl = (panelUrl: string, token: string) =>
  new URL(
    `/api/auth/reset-password/${encodeURIComponent(token)}?callbackURL=${encodeURIComponent('/reimposta')}`,
    panelUrl,
  ).toString()

export interface EnableResult {
  status: 'enabled' | 'already_active'
  /**
   * Only after a "Non sono stato io" lock: the old password no longer works. `email`: the link
   * is on its way to the account's address. `operator`: email is not configured, so the operator
   * (who controls the server anyway) hands it over on the channel used to check the identity.
   */
  recovery: null | { channel: 'email' } | { channel: 'operator'; url: string }
}

export type EnableDeps = Pick<PlatformDeps, 'uow' | 'clock' | 'config'> & {
  queue: Pick<JobQueue, 'send'>
  mailer: Pick<Mailer, 'isConfigured'>
}

const isVerificationMethod = (value: unknown): value is IdentityVerificationMethod =>
  (IDENTITY_VERIFICATION_METHODS as readonly unknown[]).includes(value)

/** The account a CLI command names by its email. */
export async function platformUserIdByEmail(
  deps: Pick<PlatformDeps, 'uow'>,
  caller: PlatformCaller,
  email: string,
): Promise<string> {
  assertPlatform(caller, 'platform.users.manage')
  const normalized = normalizeEmail(email)
  if (normalized === null) throw userNotFound()
  return deps.uow.runAsSystem('platform: find an account', async (tx) => {
    await platformAuthor(tx, caller, { ip: null })
    const user = await tx.users.findByEmail(normalized)
    if (!user) throw userNotFound()
    return user.id
  })
}

/**
 * The account, locked until the commit. A platform administrator never acts on their own
 * account or on another administrator from the panel; the CLI (system) can, to recover one.
 */
async function targetUser(tx: Tx, caller: PlatformCaller, userId: string) {
  if (!isUuid(userId)) throw userNotFound()
  const user = await tx.users.findByIdForUpdate(userId)
  if (!user) throw userNotFound()
  if (!callerIsSystem(caller) && (user.id === caller.userId || user.platformRole === 'admin'))
    throw new DomainError('FORBIDDEN', 'Non puoi modificare questo account')
  return user
}

// Sessions are closed inside the transaction and again after the commit: a sign-in that read
// the account as active just before the commit would otherwise keep its new session.

/**
 * The person loses every agency at once (spec §10.4): account disabled, every session closed.
 * Memberships stay as each agency set them. Repeating it records nothing. Says what happened,
 * so the CLI never claims a change that did not take place.
 */
export async function disableUserEverywhere(
  deps: Deps,
  caller: PlatformCaller,
  userId: string,
  request: PlatformRequest = NO_REQUEST,
): Promise<'disabled' | 'already_disabled' | 'anonymized'> {
  assertPlatform(caller, 'platform.users.manage')
  const result = await deps.uow.runAsSystem('platform: disable an account', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const user = await targetUser(tx, caller, userId)
    if (user.anonymizedAt !== null) return 'anonymized' as const
    const disabled = await tx.users.disable(userId, deps.clock.now())
    const sessionsClosed = await tx.sessions.deleteAllForUser(userId)
    if (!disabled && sessionsClosed === 0) return 'already_disabled' as const
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'user.disabled',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: author.ip,
      data: { scope: 'platform', sessionsClosed },
    })
    return 'disabled' as const
  })
  if (result === 'disabled')
    await deps.uow.runAsSystem('platform: close late sessions', (tx) =>
      tx.sessions.deleteAllForUser(userId),
    )
  return result
}

/**
 * Gives the account back, also after a "Non sono stato io" lock. Lock links issued before
 * this moment stop working (`reactivatedAt`), so an old email cannot lock it again.
 * The agencies' own decisions (disabled memberships) stay. After a "Non sono stato io" lock the
 * administrator must say how the identity was checked on an independent channel; the old
 * password stops working and a one-use link (30 minutes) to choose a new one goes to the
 * account's own address, never to the operator unless email is not configured. Otherwise
 * credentials are untouched.
 */
export async function enableUserEverywhere(
  deps: EnableDeps,
  caller: PlatformCaller,
  userId: string,
  input: EnableInput = {},
  request: PlatformRequest = NO_REQUEST,
): Promise<EnableResult> {
  assertPlatform(caller, 'platform.users.manage')
  const method: unknown = input.identityVerification?.method
  if (method !== undefined && !isVerificationMethod(method))
    throw new DomainError('VALIDATION', 'Metodo di verifica dell’identità non valido')
  // read before the transaction: no network wait while the account row is locked
  const byEmail = await deps.mailer.isConfigured()
  return deps.uow.runAsSystem('platform: enable an account', async (tx): Promise<EnableResult> => {
    const author = await platformAuthor(tx, caller, request)
    const user = await targetUser(tx, caller, userId)
    if (user.anonymizedAt !== null)
      throw new DomainError('CONFLICT', 'Questo account è stato anonimizzato')
    // "Non sono stato io": the password may be in someone else's hands, and whoever asks to get
    // back in may be them. The administrator checks the identity on another channel first.
    const locked = user.securityLockedAt !== null
    if (locked && method === undefined)
      throw new DomainError(
        'VALIDATION',
        'L’account è stato bloccato con "Non sono stato io": riattivalo solo dopo aver verificato l’identità della persona su un canale indipendente (telefonata a un numero già noto, di persona, videochiamata) e indica quale',
      )
    const now = deps.clock.now()
    if (!(await tx.users.enable(userId, now)))
      return { status: 'already_active' as const, recovery: null }
    if (locked)
      await tx.audit.record({
        organizationId: null,
        actorId: author.actorId,
        source: author.source,
        action: 'user.identity_verified',
        entity: 'user',
        entityId: userId,
        workspaceId: null,
        ip: author.ip,
        data: { method },
      })
    // a change of privileges: whatever session is left starts over (spec §15.2)
    const sessionsClosed = await tx.sessions.deleteAllForUser(userId)
    // The old password stops working in this same transaction and the person chooses a new one
    // with the link; passkeys stay (device plus user verification).
    const passwordCleared = locked && (await tx.credentials.removePassword(userId))
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'user.enabled',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: author.ip,
      data: { scope: 'platform', sessionsClosed, passwordCleared, resetLinkIssued: locked },
    })
    if (!locked) return { status: 'enabled' as const, recovery: null }
    const expiresAt = new Date(now.getTime() + ACCOUNT_RECOVERY_LINK_TTL_MS)
    const url = passwordResetLinkUrl(
      deps.config.panelUrl,
      await tx.credentials.issuePasswordResetToken(userId, expiresAt),
    )
    const channel = byEmail ? 'email' : 'operator'
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'auth.recovery_link_sent',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: author.ip,
      data: { channel },
    })
    if (!byEmail) return { status: 'enabled' as const, recovery: { channel: 'operator', url } }
    // Queued before the commit: if it fails, nothing changes and the operator retries; the
    // handler waits for the commit (it retries until the account is active).
    await deps.queue.send('identity.account_recovery_email', {
      userId,
      url,
      expiresAt: expiresAt.toISOString(),
    })
    return { status: 'enabled' as const, recovery: { channel: 'email' } }
  })
}
