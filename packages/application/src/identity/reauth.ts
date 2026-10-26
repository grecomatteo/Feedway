import { DomainError, hasRecentReauth } from '@app/domain'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { IdentityDeps } from './identity-deps.js'

const ATTEMPTS = { limit: 5, windowMs: 15 * 60_000 }

/**
 * Confirms the person behind a session with their password. A TOTP code is not accepted: the
 * library replaces the session when it checks one (ADR 012, V7). A passkey reauth is a new
 * passkey sign-in (see the login event).
 */
export async function reauthenticate(
  deps: Pick<IdentityDeps, 'uow' | 'auth' | 'clock' | 'rateLimiter'>,
  session: AuthSessionInfo,
  input: { password: string },
  request: { ip: string | null },
): Promise<void> {
  const { userId } = session
  const key = `reauth:${userId}`
  const { allowed, retryAfterMs } = await deps.rateLimiter.hit(
    key,
    ATTEMPTS.limit,
    ATTEMPTS.windowMs,
  )
  if (!allowed)
    throw new DomainError('RATE_LIMITED', 'Troppi tentativi. Riprova più tardi.', {
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    })
  // one message for every reason: a missing password says nothing more than a wrong one
  if (!(await deps.auth.verifyPassword(userId, input.password)))
    // 403, not 401: the session is still valid, only the confirmation failed
    throw new DomainError('REAUTH_FAILED', 'Password non corretta')
  await deps.uow.run({ userId }, async (tx) => {
    // revoked meanwhile: nothing to confirm
    if (!(await tx.sessions.setReauthenticated(userId, session.id, deps.clock.now())))
      throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
    await tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: 'auth.reauthenticated',
      entity: 'session',
      entityId: session.id,
      workspaceId: null,
      ip: request.ip,
      data: { method: 'password' },
    })
  })
  await deps.rateLimiter.reset(key)
}

/** For the sensitive actions: the session must have been confirmed in the last 10 minutes. */
export function assertRecentReauth(session: AuthSessionInfo, now: Date): void {
  if (!hasRecentReauth(session.reauthenticatedAt, now))
    throw new DomainError('REAUTH_REQUIRED', 'Conferma la tua identità per continuare')
}
