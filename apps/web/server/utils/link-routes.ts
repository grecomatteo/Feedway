import type { H3Event } from 'h3'
import type { IdentityDeps } from '@app/application'
import { DomainError, type DomainErrorCode } from '@app/domain'
import { passwordStrength } from '@app/infrastructure'
import type { Deps } from './deps'

const LINKS_LIMIT = { limit: 20, windowMs: 60_000 }

const STATUS: Partial<Record<DomainErrorCode, number>> = {
  LINK_INVALID: 410,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  VALIDATION: 422,
}

export function identityDeps(deps: Deps): IdentityDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    auth: deps.auth,
    tokens: deps.tokens,
    keyRing: deps.keyRing,
    passwordStrength,
    rateLimiter: deps.rateLimiter,
    config: {
      bootstrapOwnerEmail: deps.config.bootstrapOwnerEmail,
      bootstrapOrganizationName: deps.config.bootstrapOrganizationName,
      require2fa: deps.config.require2fa,
      panelUrl: deps.config.panelUrl.toString(),
    },
  }
}

export function linkError(event: H3Event, status: number, code: string, message: string) {
  const requestId = (event.context['requestId'] as string | undefined) ?? 'unknown'
  setResponseStatus(event, status)
  return { error: { code, message, requestId } }
}

/** 20 requests a minute per address over all the link routes; null when allowed. */
export async function limitLinkRoutes(event: H3Event) {
  const ip = getRequestHeader(event, 'x-app-client-ip') ?? 'unknown'
  const hit = await useDeps().rateLimiter.hit(
    `ip:links:${ip}`,
    LINKS_LIMIT.limit,
    LINKS_LIMIT.windowMs,
  )
  if (hit.allowed) return null
  setResponseHeader(event, 'retry-after', String(Math.ceil(hit.retryAfterMs / 1000)))
  return linkError(event, 429, 'RATE_LIMITED', 'Troppi tentativi. Riprova tra poco.')
}

/** Maps the expected errors of the activation use cases; anything else stays a 500. */
export function linkDomainError(event: H3Event, error: unknown) {
  if (!(error instanceof DomainError)) throw error
  const status = STATUS[error.code]
  if (status === undefined) throw error
  const answer = linkError(event, status, error.code, error.message)
  return error.details ? { error: { ...answer.error, details: error.details } } : answer
}

/** The person signed in on this browser, if any. */
export async function sessionUserId(event: H3Event): Promise<string | null> {
  const session = await useDeps().auth.getSession(event.headers)
  return session?.userId ?? null
}
