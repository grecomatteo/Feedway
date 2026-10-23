import { DomainError, normalizeEmail } from '@app/domain'
import { isUuid } from '../identity/index.js'
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

/** Like the reset links an agency copies from the panel (Task 15). */
export const PASSWORD_RESET_LINK_TTL_MS = 3600_000

/** The Better Auth route that checks the token and opens `/reimposta?token=…`. */
const passwordResetLinkUrl = (panelUrl: string, token: string) =>
  new URL(
    `/api/auth/reset-password/${encodeURIComponent(token)}?callbackURL=${encodeURIComponent('/reimposta')}`,
    panelUrl,
  ).toString()

export interface EnableResult {
  status: 'enabled' | 'already_active'
  /** Only after a "Non sono stato io" lock: the old password no longer works. */
  passwordResetUrl: string | null
}

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
 * old password stops working and the result carries a reset link (one hour) for the person;
 * otherwise credentials are untouched.
 */
export async function enableUserEverywhere(
  deps: Pick<PlatformDeps, 'uow' | 'clock' | 'config'>,
  caller: PlatformCaller,
  userId: string,
  request: PlatformRequest = NO_REQUEST,
): Promise<EnableResult> {
  assertPlatform(caller, 'platform.users.manage')
  const result = await deps.uow.runAsSystem('platform: enable an account', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const user = await targetUser(tx, caller, userId)
    if (user.anonymizedAt !== null)
      throw new DomainError('CONFLICT', 'Questo account è stato anonimizzato')
    const now = deps.clock.now()
    if (!(await tx.users.enable(userId, now)))
      return { status: 'already_active' as const, token: null }
    // a change of privileges: whatever session is left starts over (spec §15.2)
    const sessionsClosed = await tx.sessions.deleteAllForUser(userId)
    // "Non sono stato io": the password may be in someone else's hands. It stops working in
    // this same transaction and the person chooses a new one with the link; passkeys stay
    // (device plus user verification).
    const locked = user.securityLockedAt !== null
    const passwordCleared = locked && (await tx.credentials.removePassword(userId))
    const token = locked
      ? await tx.credentials.issuePasswordResetToken(
          userId,
          new Date(now.getTime() + PASSWORD_RESET_LINK_TTL_MS),
        )
      : null
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
    return { status: 'enabled' as const, token }
  })
  return {
    status: result.status,
    passwordResetUrl:
      result.token === null ? null : passwordResetLinkUrl(deps.config.panelUrl, result.token),
  }
}
