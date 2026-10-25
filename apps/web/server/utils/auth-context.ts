import type { H3Event } from 'h3'
import { resolveSession, type ResolvedSession, type SessionUser } from '@app/application'
import type { AuthSessionInfo } from '@app/application'
import type { OrgActor } from '@app/domain'
import { HttpProblem } from './http-errors'

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    /** The session of the request, resolved once (middleware 20.session or the first caller). */
    auth?: Promise<ResolvedSession | null>
    /** The agency actor of `/orgs/:org/**`, resolved once (utils/org-context.ts). */
    orgActor?: Promise<OrgActor>
  }
}

export const requestIdOf = (event: H3Event): string => event.context.requestId ?? 'unknown'

/**
 * The person behind the request, resolved once: our 30 days, a disabled or anonymized person
 * signed out on the spot (`resolveSession`). A renewed session cookie goes back with the
 * answer, before any cookie the handler sets, so a new session set by a sign-in wins.
 */
export function loadSession(event: H3Event): Promise<ResolvedSession | null> {
  event.context.auth ??= resolveSession(identityDeps(useDeps()), { headers: event.headers }).then(
    (resolved) => {
      for (const cookie of resolved?.setCookie ?? [])
        appendResponseHeader(event, 'set-cookie', cookie)
      return resolved
    },
  )
  return event.context.auth
}

/** The 403 a session that still owes the second factor gets (Task 13). */
export function secondFactorProblem(factors: { totpEnabled: boolean; passkeys: number }) {
  // a stolen password alone may not add a factor next to the one the person already has
  return factors.totpEnabled || factors.passkeys > 0
    ? new HttpProblem('SECOND_FACTOR_REQUIRED', { reason: 'use_existing_factor' })
    : new HttpProblem('SECOND_FACTOR_REQUIRED')
}

/** An active session, or 401 (none) / 403 (second factor still owed). */
export async function requireActiveSession(event: H3Event): Promise<ResolvedSession> {
  const resolved = await loadSession(event)
  if (!resolved) throw new HttpProblem('UNAUTHENTICATED')
  if (resolved.state !== 'active') throw secondFactorProblem(resolved.user.secondFactor)
  return resolved
}

export async function requireUser(event: H3Event): Promise<SessionUser> {
  return (await requireActiveSession(event)).user
}

export async function requireSession(event: H3Event): Promise<AuthSessionInfo> {
  return (await requireActiveSession(event)).session
}
