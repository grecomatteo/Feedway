import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Clock, RateLimiter } from '@app/application'
import { checkPassword, loginDelayMs, type AuthMethod } from '@app/domain'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { Db } from '../db/client.js'
import { users } from '../db/identity/schema.js'
import { passwordStrength } from '../crypto/password-strength.js'
import { enforceIpLimit, tooManyRequests } from './rate-limits.js'

/**
 * Every HTTP route the panel serves from Better Auth. Anything else answers 404, so a route that
 * a library update adds stays closed until we open it (V10: these checks run only when the
 * request is an HTTP request, `ctx.request` present).
 */
export const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/email',
  '/sign-out',
  '/get-session',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/change-password',
  '/change-email',
  '/verify-email',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/get-totp-uri',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/list-user-passkeys',
  '/passkey/update-passkey',
  '/passkey/delete-passkey',
])

/** Which sign-in path gave the session its method (V9); unknown paths keep the default. */
const METHOD_BY_PATH: Readonly<Record<string, AuthMethod>> = {
  '/sign-in/email': 'password',
  '/two-factor/verify-totp': 'password_totp',
  '/two-factor/verify-backup-code': 'password_backup_code',
  '/passkey/verify-authentication': 'passkey',
}

export function authMethodForPath(path: string | undefined): AuthMethod | undefined {
  return path === undefined ? undefined : METHOD_BY_PATH[path]
}

export const loginKey = (email: string) =>
  `login:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`

export interface HookDeps {
  db: Db
  clock: Clock
  rateLimiter: RateLimiter
}

const clientIp = (request: Request): string => request.headers.get('x-app-client-ip') ?? 'unknown'

/** Growing wait per account after five consecutive failures (`loginDelayMs`). */
async function enforceLoginDelay(deps: HookDeps, email: string): Promise<void> {
  const { count, lastAt } = await deps.rateLimiter.failures(loginKey(email))
  const delay = loginDelayMs(count)
  if (delay === 0 || lastAt === null) return
  const waitedMs = deps.clock.now().getTime() - lastAt.getTime()
  if (waitedMs < delay) throw tooManyRequests(Math.ceil((delay - waitedMs) / 1000))
}

export function createBeforeHook(deps: HookDeps) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.request) return // our own server-side calls are checked by the use cases
    const path = ctx.path
    if (!ALLOWED_PATHS.has(path)) throw new APIError('NOT_FOUND', { message: 'Non trovato' })
    await enforceIpLimit(deps.rateLimiter, path, clientIp(ctx.request))

    const body = (ctx.body ?? {}) as Record<string, unknown>
    if (body['trustDevice'] === true)
      throw new APIError('BAD_REQUEST', { message: 'Ricordare il dispositivo non è disponibile' })

    if (path === '/sign-in/email' && typeof body['email'] === 'string')
      await enforceLoginDelay(deps, body['email'])

    if (path === '/reset-password' || path === '/change-password') {
      const newPassword = typeof body['newPassword'] === 'string' ? body['newPassword'] : ''
      const user = ctx.context.session?.user
      const check = checkPassword(
        newPassword,
        { email: user?.email ?? '', name: user?.name ?? '' },
        passwordStrength,
      )
      if (!check.ok)
        throw new APIError('UNPROCESSABLE_ENTITY', { message: check.reason, code: check.reason })
    }
  })
}

export function createAfterHook(deps: HookDeps) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.request || ctx.path !== '/sign-in/email') return
    const body = (ctx.body ?? {}) as Record<string, unknown>
    const email = body['email']
    if (typeof email !== 'string') return
    const key = loginKey(email)
    if (ctx.context.returned instanceof APIError) await deps.rateLimiter.recordFailure(key)
    else await deps.rateLimiter.reset(key)
  })
}

/** A disabled or anonymized person opens no session, whatever the method. */
export async function mayOpenSession(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: users.status, anonymizedAt: users.anonymizedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row !== undefined && row.status === 'active' && row.anonymizedAt === null
}
