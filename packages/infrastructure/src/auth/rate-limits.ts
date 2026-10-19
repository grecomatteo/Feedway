import type { RateLimiter } from '@app/application'
import { APIError } from 'better-auth/api'

const MINUTE = 60_000
const FIFTEEN_MINUTES = 15 * MINUTE

/** Per-IP limits from the spec (§15.1). The first matching rule wins. */
export function ipRuleFor(path: string): { bucket: string; limit: number; windowMs: number } {
  if (path === '/sign-in/email') return { bucket: 'sign-in', limit: 10, windowMs: MINUTE }
  if (path.startsWith('/two-factor/')) return { bucket: 'two-factor', limit: 10, windowMs: MINUTE }
  if (
    path === '/passkey/generate-authenticate-options' ||
    path === '/passkey/verify-authentication'
  )
    return { bucket: 'passkey-sign-in', limit: 20, windowMs: MINUTE }
  if (path === '/request-password-reset' || path.startsWith('/reset-password'))
    return { bucket: 'reset', limit: 5, windowMs: FIFTEEN_MINUTES }
  return { bucket: 'generic', limit: 100, windowMs: 10_000 }
}

export function tooManyRequests(retryAfterSeconds: number): APIError {
  return new APIError(
    'TOO_MANY_REQUESTS',
    { message: 'Troppi tentativi. Riprova più tardi.', code: 'RATE_LIMITED' },
    { 'Retry-After': String(Math.max(1, retryAfterSeconds)) },
  )
}

/** Counts the request against its IP and answers 429 when the window is used up. */
export async function enforceIpLimit(
  rateLimiter: RateLimiter,
  path: string,
  ip: string,
): Promise<void> {
  const rule = ipRuleFor(path)
  const result = await rateLimiter.hit(`ip:${rule.bucket}:${ip}`, rule.limit, rule.windowMs)
  if (!result.allowed) throw tooManyRequests(Math.ceil(result.retryAfterMs / 1000))
}
