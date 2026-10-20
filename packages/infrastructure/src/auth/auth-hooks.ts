import { createHash } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  allowedWhileSecondFactorRequired,
  type AuthEvent,
  type AuthEventSink,
  type AuthSessionInfo,
  type Clock,
  type Logger,
  type RateLimiter,
  type SessionState,
  type SessionUser,
} from '@app/application'
import {
  canRemoveSecondFactor,
  checkPassword,
  hasRecentReauth,
  isBeyondAbsoluteLifetime,
  loginDelayMs,
  type AuthMethod,
  sessionSatisfiesSecondFactor,
} from '@app/domain'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { Db } from '../db/client.js'
import { passkeys, sessions, users } from '../db/identity/schema.js'
import { passwordStrength } from '../crypto/password-strength.js'
import { toAuthMethod, toSessionInfo } from './auth-method.js'
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

/** The panel page a reset link lands on, with `?token=…` (Task 22). */
export const PASSWORD_RESET_PAGE = '/reimposta'

/** Reset tokens of links copied from the panel (auth-adapter.ts); never letters and digits only. */
export const PANEL_RESET_TOKEN_PREFIX = 'panel.'

/** The message a wrong password and a refused session both get, so neither reveals the other. */
export const INVALID_CREDENTIALS = 'Email o password non corretti'

export const loginKey = (email: string) =>
  `login:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`

/** The person of a valid session and its second-factor state; null for a disabled person. */
export type SessionUserResolver = (
  session: AuthSessionInfo,
) => Promise<{ user: SessionUser; state: SessionState } | null>

export interface HookDeps {
  db: Db
  clock: Clock
  rateLimiter: RateLimiter
  events: AuthEventSink
  logger: Logger
  resolveSessionUser: SessionUserResolver
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
  /** TOTP state before a change to the account: a verified code then completes an enrolment. */
  totpEnabledBefore?: boolean
}
const pending = new WeakMap<Request, Pending>()

const signingIn = new WeakMap<Request, Promise<string | undefined>>()

/**
 * The person a pending second factor belongs to (sign-in with 2FA, before the code). Read once
 * per request: each lookup also sweeps the expired verifications, and returns them too.
 */
function pendingSecondFactorUser(
  deps: Pick<HookDeps, 'clock'>,
  ctx: HookContext,
  request: Request,
): Promise<string | undefined> {
  const known = signingIn.get(request)
  if (known) return known
  const found = (async () => {
    const cookie = ctx.context.createAuthCookie('two_factor')
    const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
    if (typeof identifier !== 'string' || identifier === '') return undefined
    const verification = await ctx.context.internalAdapter.findVerificationValue(identifier)
    if (!verification || verification.expiresAt <= deps.clock.now()) return undefined
    return verification.value
  })()
  signingIn.set(request, found)
  return found
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
 * The session behind the request's cookie, read straight from the table and never through
 * getSessionFromCtx, which would also refresh the old session and could set its cookie again
 * in the answer that carries the new one. `past_lifetime`: Better Auth still accepts it, our
 * 30 days do not.
 */
async function cookieSession(
  deps: Pick<HookDeps, 'db' | 'clock'>,
  ctx: HookContext,
): Promise<AuthSessionInfo | 'none' | 'past_lifetime'> {
  const signed = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  )
  if (typeof signed !== 'string' || signed === '') return 'none'
  const now = deps.clock.now()
  const [row] = await deps.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, signed), gt(sessions.expiresAt, now)))
    .limit(1)
  if (!row) return 'none'
  return isBeyondAbsoluteLifetime(row.createdAt, now) ? 'past_lifetime' : toSessionInfo(row)
}

/** The valid session behind the request's cookie, if any. */
async function sessionOfCookie(
  deps: Pick<HookDeps, 'db' | 'clock'>,
  ctx: HookContext,
): Promise<{ id: string; userId: string } | undefined> {
  const found = await cookieSession(deps, ctx)
  return typeof found === 'string' ? undefined : { id: found.id, userId: found.userId }
}

/**
 * A sign-in that reaches the code step in a browser still holding an older session: the
 * library would check the code against that session and keep it, so the person would stay
 * where they were. The older session goes, unless it is this person's, valid and already past
 * the second factor; the new one replaces its cookie anyway. It goes even if the code then
 * turns out wrong: only a browser shared by two people at once loses a session that way.
 */
async function dropLeftoverSession(
  deps: HookDeps,
  ctx: HookContext,
  request: Request,
): Promise<void> {
  if (!SECOND_FACTOR_PROOFS.has(ctx.path)) return
  const person = await pendingSecondFactorUser(deps, ctx, request)
  if (person === undefined) return
  const signed = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  )
  if (typeof signed !== 'string' || signed === '') return
  const found = await cookieSession(deps, ctx)
  if (
    typeof found !== 'string' &&
    found.userId === person &&
    sessionSatisfiesSecondFactor(found.authMethod)
  )
    return
  await deps.db.delete(sessions).where(eq(sessions.token, signed))
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
    const userId = await pendingSecondFactorUser(deps, ctx, request)
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

/**
 * Paths that change or read the signed-in person's own account and factors. With a session
 * cookie, `verify-totp` and `verify-backup-code` act on that session (an enrolment); without
 * one they are a sign-in and these rules do not apply.
 */
const ACCOUNT_PATHS: ReadonlySet<string> = new Set([
  '/change-password',
  '/change-email',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/get-totp-uri',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/list-user-passkeys',
  '/passkey/update-passkey',
  '/passkey/delete-passkey',
])

/** Paths that check a code: a sign-in with the 2FA cookie, or an enrolment over a session. */
const SECOND_FACTOR_PROOFS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
])

/** Changes that weaken the account: the session must have been confirmed in the last minutes. */
const NEEDS_REAUTH: ReadonlySet<string> = new Set([
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/delete-passkey',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sessionExpired = () =>
  new APIError('UNAUTHORIZED', {
    message: 'Sessione scaduta: accedi di nuovo',
    code: 'UNAUTHENTICATED',
  })

function secondFactorMissing(factors: { totpEnabled: boolean; passkeys: number }): APIError {
  // a stolen password alone may not add a factor next to the one the person already has
  if (factors.totpEnabled || factors.passkeys > 0)
    return new APIError('FORBIDDEN', {
      message: "Hai già una passkey o l'app di autenticazione: esci e accedi con quella",
      code: 'SECOND_FACTOR_REQUIRED',
      reason: 'use_existing_factor',
    })
  return new APIError('FORBIDDEN', {
    message: "Configura prima una passkey o l'app di autenticazione",
    code: 'SECOND_FACTOR_REQUIRED',
  })
}

async function ownsPasskey(db: Db, userId: string, passkeyId: unknown): Promise<boolean> {
  if (typeof passkeyId !== 'string' || !UUID.test(passkeyId)) return false
  const [row] = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .limit(1)
  return row !== undefined
}

/**
 * Our rules on the account paths, with the session resolved as `resolveSession` does: our 30
 * days, the person still active, the second factor the session owes. They fail closed.
 */
async function enforceAccountRules(
  deps: HookDeps,
  ctx: HookContext,
  request: Request,
): Promise<void> {
  const path = ctx.path
  if (!ACCOUNT_PATHS.has(path)) return
  // A session left next to a 2FA cookie is already gone unless it is this person's, valid and
  // past the second factor (dropLeftoverSession): no exception is needed for the code paths.
  const found = await cookieSession(deps, ctx)
  // no session: the endpoint refuses on its own, or it is a sign-in with the 2FA cookie
  if (found === 'none') return
  if (found === 'past_lifetime') throw sessionExpired()
  const resolved = await deps.resolveSessionUser(found)
  if (!resolved) throw sessionExpired()
  const factors = resolved.user.secondFactor
  pending.set(request, {
    ...pending.get(request),
    userId: found.userId,
    sessionId: found.id,
    totpEnabledBefore: factors.totpEnabled,
  })

  if (
    resolved.state === 'second_factor_required' &&
    !allowedWhileSecondFactorRequired(request.method, `/api/auth${path}`, factors)
  )
    throw secondFactorMissing(factors)

  if (NEEDS_REAUTH.has(path) && !hasRecentReauth(found.reauthenticatedAt, deps.clock.now()))
    throw new APIError('FORBIDDEN', {
      message: 'Conferma la tua identità per continuare',
      code: 'REAUTH_REQUIRED',
    })

  if (path !== '/two-factor/disable' && path !== '/passkey/delete-passkey') return
  const removing = path === '/two-factor/disable' ? 'totp' : 'passkey'
  if (removing === 'passkey') {
    const body = (ctx.body ?? {}) as Record<string, unknown>
    // someone else's passkey, or none: the same answer, so ids reveal nothing
    if (!(await ownsPasskey(deps.db, found.userId, body['id'])))
      throw new APIError('NOT_FOUND', { message: 'Passkey non trovata', code: 'NOT_FOUND' })
  }
  if (!canRemoveSecondFactor({ ...factors, removing }))
    throw new APIError('FORBIDDEN', {
      message:
        "La 2FA è obbligatoria per il tuo ruolo: aggiungi prima un'altra passkey o l'app di autenticazione",
      code: 'SECOND_FACTOR_REQUIRED',
    })
}

export function createBeforeHook(deps: HookDeps) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.request) return // our own server-side calls are checked by the use cases
    const path = ctx.path
    if (!ALLOWED_PATHS.has(path)) throw new APIError('NOT_FOUND', { message: 'Non trovato' })
    await enforceIpLimit(deps.rateLimiter, path, clientIp(ctx.request))

    const body = (ctx.body ?? {}) as Record<string, unknown>
    // Trusting a device would skip the second factor for it; the 12-hour idle limit needs a
    // session that is renewed on use, which `rememberMe: false` turns off; a passkey
    // registration would clone the session with no sign-in recorded.
    if (
      body['trustDevice'] === true ||
      body['rememberMe'] === false ||
      body['createSession'] === true
    )
      throw new APIError('BAD_REQUEST', { message: 'Opzione non disponibile' })

    // before anything reads the session: once read, the library keeps it for the request
    await dropLeftoverSession(deps, ctx, ctx.request)
    try {
      await rememberBefore(deps, ctx, ctx.request)
    } catch (error) {
      // only the event is lost; the request itself goes on
      deps.logger.error(
        { requestId: header(ctx.request, 'x-app-request-id'), path, err: error },
        'auth event context not read',
      )
    }

    const email = body['email']
    if (path === '/sign-in/email' && typeof email === 'string') await enforceLoginDelay(deps, email)

    if (path === '/reset-password') await enforcePanelResetScope(deps.db, ctx)

    if (path === '/reset-password' || path === '/change-password') {
      const newPassword = typeof body['newPassword'] === 'string' ? body['newPassword'] : ''
      // The session is not in the context yet on a hook: read it ourselves for the name and email;
      // on a reset, the person behind the token.
      const person =
        path === '/change-password'
          ? (await getSessionFromCtx(ctx))?.user
          : await resetTokenPerson(deps.db, ctx)
      const check = checkPassword(
        newPassword,
        { email: person?.email ?? '', name: person?.name ?? '' },
        passwordStrength,
      )
      if (!check.ok)
        throw new APIError('UNPROCESSABLE_ENTITY', { message: check.reason, code: check.reason })
    }

    await enforceAccountRules(deps, ctx, ctx.request)

    // A new password signs out every other device, whatever the browser asked (spec §15.2):
    // whoever knew the old one must not stay in.
    if (path === '/change-password')
      return { context: { body: { ...body, revokeOtherSessions: true } } }
  })
}

function resetToken(ctx: HookContext): string | null {
  const body = (ctx.body ?? {}) as Record<string, unknown>
  const token = body['token'] ?? (ctx.query as Record<string, unknown> | undefined)?.['token']
  return typeof token === 'string' && token !== '' ? token : null
}

/** The account a reset token belongs to; null for an unknown token. */
async function resetTokenUserId(ctx: HookContext, token: string): Promise<string | null> {
  const verification = await ctx.context.internalAdapter.findVerificationValue(
    `reset-password:${token}`,
  )
  return verification && UUID.test(verification.value) ? verification.value : null
}

/**
 * A link copied from the panel is checked again when it is used: the agency that made it may
 * still reset this identity only while the person works for that agency alone and is not the
 * platform administrator (spec §10.4). "Password dimenticata" links are the person's own.
 */
async function enforcePanelResetScope(db: Db, ctx: HookContext): Promise<void> {
  const token = resetToken(ctx)
  if (token === null || !token.startsWith(PANEL_RESET_TOKEN_PREFIX)) return
  const userId = await resetTokenUserId(ctx, token)
  // unknown or expired: the endpoint answers INVALID_TOKEN
  if (userId === null) return
  const { rows } = await db.execute<{ n: number; platform_role: string | null }>(
    sql`select organization_count(${userId}::uuid) as n,
               (select platform_role from users where id = ${userId}::uuid) as platform_role`,
  )
  const row = rows[0]
  if (row?.n !== 1 || row.platform_role !== null)
    throw new APIError('FORBIDDEN', {
      message:
        'Questo link non vale più: chiedine uno nuovo a chi gestisce l’agenzia o usa “Password dimenticata”',
      code: 'FORBIDDEN',
    })
}

/** Email and name of the account a reset token belongs to; null for an unknown token. */
async function resetTokenPerson(
  db: Db,
  ctx: HookContext,
): Promise<{ email: string; name: string } | null> {
  const given = resetToken(ctx)
  if (given === null) return null
  const userId = await resetTokenUserId(ctx, given)
  if (userId === null) return null
  const [row] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row ?? null
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
    // With the session in use a verified code is not a sign-in: it completes a TOTP enrolment
    // (the endpoint replaces the session), or does nothing when TOTP was already on.
    if (path.startsWith('/two-factor/') && remembered.sessionId !== undefined) {
      return path === '/two-factor/verify-totp' &&
        remembered.totpEnabledBefore === false &&
        remembered.userId !== undefined
        ? { kind: 'totp_enabled', userId: remembered.userId, ip, userAgent }
        : null
    }
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
    case '/two-factor/disable':
      // the library also cancels an enrolment never finished: nothing was on to turn off
      return remembered.totpEnabledBefore === true
        ? { kind: 'totp_disabled', userId, ip, userAgent }
        : null
    case '/two-factor/generate-backup-codes':
      return { kind: 'backup_codes_regenerated', userId, ip, userAgent }
    case '/passkey/verify-registration':
      return { kind: 'passkey_added', userId, ip, userAgent }
    case '/passkey/delete-passkey':
      return { kind: 'passkey_removed', userId, ip, userAgent }
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
