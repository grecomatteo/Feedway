import { lockAccountFromSecurityEmail } from '@app/application'
import { DomainError } from '@app/domain'
import { z } from 'zod'

const Body = z.object({ token: z.string().min(1).max(512) })

const LOCK_LIMIT = { limit: 5, windowMs: 60_000 }

// Public: the link comes from a security email, with no session. Task 19 moves it to
// defineApiRoute and the shared error mapping.
export default defineEventHandler(async (event) => {
  const deps = useDeps()
  const requestId = (event.context['requestId'] as string | undefined) ?? 'unknown'
  const fail = (status: number, code: string, message: string) => {
    setResponseStatus(event, status)
    return { error: { code, message, requestId } }
  }
  const ip = getRequestHeader(event, 'x-app-client-ip') ?? null
  const hit = await deps.rateLimiter.hit(
    `ip:security-lock:${ip ?? 'unknown'}`,
    LOCK_LIMIT.limit,
    LOCK_LIMIT.windowMs,
  )
  if (!hit.allowed) {
    setResponseHeader(event, 'retry-after', String(Math.ceil(hit.retryAfterMs / 1000)))
    return fail(429, 'RATE_LIMITED', 'Troppi tentativi. Riprova tra poco.')
  }
  const body = Body.safeParse(await readBody(event).catch(() => null))
  if (!body.success) return fail(422, 'VALIDATION', 'Richiesta non valida.')
  try {
    await lockAccountFromSecurityEmail(
      { uow: deps.uow, tokens: deps.signedTokens, clock: deps.clock },
      { token: body.data.token, ip },
    )
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LINK_INVALID')
      return fail(410, 'LINK_INVALID', error.message)
    throw error
  }
  return { locked: true }
})
