import { createHash } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import type { AuthEvent, AuthEventSink, Clock, Logger, RateLimiter } from '@app/application'
import { checkPassword, isBeyondAbsoluteLifetime, loginDelayMs, type AuthMethod } from '@app/domain'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { Db } from '../db/client.js'
import { sessions, users } from '../db/identity/schema.js'
import { passwordStrength } from '../crypto/password-strength.js'
import { toAuthMethod } from './auth-method.js'
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

/** Which sign-in path gives a new session its method (V9). */
const METHOD_BY_PATH: Readonly<Record<string, AuthMethod>> = {
  '/sign-in/email': 'password',
  '/two-factor/verify-totp': 'password_totp',
  '/two-factor/verify-backup-code': 'password_backup_code',
  '/passkey/verify-authentication': 'passkey',
}

export function authMethodForPath(path: string | undefined): AuthMethod | undefined {
  return path === undefined ? undefined : METHOD_BY_PATH[path]
}

/** The message a wrong password and a refused session both get, so neither reveals the other. */
export const INVALID_CREDENTIALS = 'Email o password non corretti'

export const loginKey = (email: string) =>
  `login:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`

export interface HookDeps {
  db: Db
  clock: Clock
  rateLimiter: RateLimiter
  events: AuthEventSink
  logger: Logger
}

const clientIp = (request: Request): string => request.headers.get('x-app-client-ip') ?? 'unknown'

/** A request header written by our middleware (Task 10); absent or empty is null. */
const header = (request: Request, name: string): string | null => {
  const value = request.headers.get(name)
  return value === null || value === '' ? null : value
}

/**
 * What the `before` hook learns that is gone by the time `after` runs: the session that
 * signs out, the person behind a password reset token or a pending second factor.
 */
interface Pending {
  userId?: string
  sessionId?: string
  /** The valid session a passkey sign-in arrives with: the sign-in is then a reauth. */
  previousSession?: { id: string; userId: string }
}
const pending = new WeakMap<Request, Pending>()

/** The person a pending second factor belongs to (sign-in with 2FA, before the code). */
async function pendingSecondFactorUser(ctx: HookContext): Promise<string | undefined> {
  const cookie = ctx.context.createAuthCookie('two_factor')
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
  if (typeof identifier !== 'string' || identifier === '') return undefined
  const verification = await ctx.context.internalAdapter.findVerificationValue(identifier)
  return verification?.value
}

// Only where the endpoint reads the session itself: getSessionFromCtx caches it in the context,
// and on a sign-in path the new session would then inherit the old one (the 30-day start).
const READS_SESSION = new Set([
  '/sign-out',
  '/change-password',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
])

/**
 * The valid session behind the request's cookie, read straight from the table and never
 * through getSessionFromCtx, which would also refresh the old session and could set its
 * cookie again in the answer that carries the new one.
 */
async function sessionOfCookie(
  deps: Pick<HookDeps, 'db' | 'clock'>,
  ctx: HookContext,
): Promise<{ id: string; userId: string } | undefined> {
  const signed = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  )
  if (typeof signed !== 'string' || signed === '') return undefined
  const now = deps.clock.now()
  const [row] = await deps.db
    .select({ id: sessions.id, userId: sessions.userId, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(eq(sessions.token, signed), gt(sessions.expiresAt, now)))
    .limit(1)
  if (!row || isBeyondAbsoluteLifetime(row.createdAt, now)) return undefined
  return { id: row.id, userId: row.userId }
}

async function rememberBefore(deps: HookDeps, ctx: HookContext, request: Request): Promise<void> {
  const path = ctx.path
  if (path === '/passkey/verify-authentication') {
    const previousSession = await sessionOfCookie(deps, ctx)
    if (previousSession) pending.set(request, { previousSession })
    return
  }
  if (READS_SESSION.has(path)) {
    const current = await getSessionFromCtx(ctx)
    if (current) {
      pending.set(request, { userId: current.user.id, sessionId: current.session.id })
      return
    }
  }
  if (path === '/two-factor/verify-totp' || path === '/two-factor/verify-backup-code') {
    const userId = await pendingSecondFactorUser(ctx)
    if (userId !== undefined) pending.set(request, { userId })
  } else if (path === '/reset-password') {
    const body = (ctx.body ?? {}) as Record<string, unknown>
    const token = body['token'] ?? (ctx.query as Record<string, unknown> | undefined)?.['token']
    if (typeof token !== 'string' || token === '') return
    const verification = await ctx.context.internalAdapter.findVerificationValue(
      `reset-password:${token}`,
    )
    if (verification) pending.set(request, { userId: verification.value })
  }
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

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
    try {
      await rememberBefore(deps, ctx, ctx.request)
    } catch (error) {
      // only the event is lost; the request itself goes on
      deps.logger.error(
        { requestId: header(ctx.request, 'x-app-request-id'), path, err: error },
        'auth event context not read',
      )
    }

    const body = (ctx.body ?? {}) as Record<string, unknown>
    // Trusting a device would skip the second factor for it; the 12-hour idle limit needs a
    // session that is renewed on use, which `rememberMe: false` turns off.
    if (body['trustDevice'] === true || body['rememberMe'] === false)
      throw new APIError('BAD_REQUEST', { message: 'Opzione non disponibile' })

    const email = body['email']
    if (path === '/sign-in/email' && typeof email === 'string') await enforceLoginDelay(deps, email)

    if (path === '/reset-password' || path === '/change-password') {
      const newPassword = typeof body['newPassword'] === 'string' ? body['newPassword'] : ''
      // The session is not in the context yet on a hook: read it ourselves for the name and email.
      const current = path === '/change-password' ? await getSessionFromCtx(ctx) : null
      const check = checkPassword(
        newPassword,
        { email: current?.user.email ?? '', name: current?.user.name ?? '' },
        passwordStrength,
      )
      if (!check.ok)
        throw new APIError('UNPROCESSABLE_ENTITY', { message: check.reason, code: check.reason })
    }
  })
}

async function userIdByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)
  return row?.id ?? null
}

/** Turns what Better Auth just did into our event, or null when it is not one we record. */
async function eventFor(
  deps: HookDeps,
  ctx: HookContext,
  request: Request,
): Promise<AuthEvent | null> {
  const path = ctx.path
  const failed = ctx.context.returned instanceof APIError
  const remembered = pending.get(request) ?? {}
  const ip = header(request, 'x-app-client-ip')
  const userAgent = header(request, 'user-agent')

  if (METHOD_BY_PATH[path] !== undefined) {
    if (failed) {
      if (path === '/sign-in/email') {
        const email = (ctx.body as Record<string, unknown> | undefined)?.['email']
        if (typeof email !== 'string') return null
        const userId = await userIdByEmail(deps.db, email)
        return { kind: 'login_failed', stage: 'password', email, userId, ip }
      }
      // A wrong code while signing in; with a session it is an enrolment, not a sign-in, and
      // without the 2FA cookie nobody was signing in.
      if (
        path.startsWith('/two-factor/') &&
        remembered.sessionId === undefined &&
        remembered.userId !== undefined
      ) {
        return {
          kind: 'login_failed',
          stage: 'second_factor',
          email: null,
          userId: remembered.userId,
          ip,
        }
      }
      return null
    }
    // TOTP enrolment replaces the session in use: not a sign-in (Task 14 records it).
    if (path.startsWith('/two-factor/') && remembered.sessionId !== undefined) return null
    // typed here: the hook context does not know our additional session fields
    const created = ctx.context.newSession as {
      session: { id: string; userId: string; authMethod?: unknown }
      user: { twoFactorEnabled?: boolean | null }
    } | null
    // A password sign-in with 2FA waits for the code: the two-factor plugin drops this session.
    if (!created || (path === '/sign-in/email' && created.user.twoFactorEnabled === true))
      return null
    return {
      kind: 'login',
      userId: created.session.userId,
      sessionId: created.session.id,
      method: toAuthMethod(created.session.authMethod),
      ip,
      userAgent,
      deviceId: header(request, 'x-app-device-id'),
      // only a passkey sign-in reads the session it arrives with, and only the same person's
      previousSessionId:
        remembered.previousSession?.userId === created.session.userId
          ? remembered.previousSession.id
          : null,
    }
  }
  if (failed || remembered.userId === undefined) return null
  const userId = remembered.userId
  switch (path) {
    case '/sign-out':
      return remembered.sessionId === undefined
        ? null
        : { kind: 'logout', userId, sessionId: remembered.sessionId, ip }
    case '/change-password':
      return { kind: 'password_changed', userId, ip, userAgent }
    case '/reset-password':
      return { kind: 'password_reset', userId, ip, userAgent }
    default:
      return null
  }
}

async function recordEvent(deps: HookDeps, ctx: HookContext, request: Request): Promise<void> {
  const requestId = header(request, 'x-app-request-id')
  try {
    const event = await eventFor(deps, ctx, request)
    if (event) await deps.events.record(event, { requestId })
  } catch (error) {
    // Better Auth has already done its work: a lost event must not change the answer.
    deps.logger.error({ requestId, path: ctx.path, err: error }, 'auth event not recorded')
  }
}

export function createAfterHook(deps: HookDeps) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.request) return
    await recordEvent(deps, ctx, ctx.request)
    if (ctx.path !== '/sign-in/email') return
    const email = (ctx.body as Record<string, unknown> | undefined)?.['email']
    if (typeof email !== 'string') return
    const key = loginKey(email)
    const returned = ctx.context.returned
    if (!(returned instanceof APIError)) {
      await deps.rateLimiter.reset(key)
      return
    }
    await deps.rateLimiter.recordFailure(key)
    // A refused session (disabled or anonymized account) answers like a wrong password.
    const code = returned.body?.code
    if (code === 'FAILED_TO_CREATE_SESSION' || code === 'INVALID_EMAIL_OR_PASSWORD')
      throw new APIError('UNAUTHORIZED', {
        message: INVALID_CREDENTIALS,
        code: 'INVALID_EMAIL_OR_PASSWORD',
      })
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
