import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { z } from 'zod'
import { SESSION_IDLE_MS, type AuthMethod } from '@app/domain'
import type {
  AuthEventSink,
  Clock,
  IdGenerator,
  JobQueue,
  Logger,
  PasswordHasher,
  RateLimiter,
} from '@app/application'
import type { SessionUserResolver } from './auth-hooks.js'
import type { Db } from '../db/client.js'
import * as schema from '../db/identity/schema.js'
import { COOKIE_NAMES } from './cookie-names.js'
import {
  authMethodForPath,
  createAfterHook,
  createBeforeHook,
  mayOpenSession,
} from './auth-hooks.js'

export interface BetterAuthConfig {
  panelUrl: string
  productName: string
  secret: string
  secrets: { version: number; value: string }[]
}

export interface BetterAuthDeps {
  db: Db
  config: BetterAuthConfig
  ids: IdGenerator
  clock: Clock
  hasher: PasswordHasher
  rateLimiter: RateLimiter
  logger: Logger
  /** Sign-ins, failures and credential changes go to the activity log and security emails. */
  events: AuthEventSink
  /** "Password dimenticata" queues `identity.password_reset_email`. */
  queue: Pick<JobQueue, 'send'>
  /**
   * `resolveSessionUser` from the application, bound to its unit of work: the hooks apply our
   * second-factor rules with it, since they cannot go through `Auth` (it wraps this instance).
   */
  resolveSessionUser: SessionUserResolver
}

/** Paths where a person signs in from scratch: the session never inherits an older one. */
const STARTS_NEW_SESSION: ReadonlySet<string> = new Set([
  '/sign-in/email',
  '/passkey/verify-authentication',
])

/** Our own endpoint, never served over HTTP: only `Auth.openSession` calls it. */
export const OPEN_SESSION_PATH = '/internal/open-session'

/**
 * The session an activation opens (ADR 012, V8): created and signed by Better Auth inside an
 * endpoint, so name, attributes and signature are those of a real sign-in.
 */
const activationSession = {
  id: 'activation-session',
  endpoints: {
    openActivationSession: createAuthEndpoint(
      OPEN_SESSION_PATH,
      {
        method: 'POST',
        // left out of the HTTP router; the before hook answers 404 for it too (ALLOWED_PATHS)
        metadata: { SERVER_ONLY: true },
        body: z.object({
          userId: z.string(),
          ipAddress: z.string().nullable(),
          userAgent: z.string().nullable(),
        }),
      },
      async (ctx) => {
        const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId)
        if (!user) throw new Error('activation session for an unknown user')
        // overrideAll: without it the default value of authMethod wins over ours (V8)
        const session = await ctx.context.internalAdapter.createSession(
          user.id,
          false,
          {
            authMethod: 'activation',
            ...(ctx.body.ipAddress === null ? {} : { ipAddress: ctx.body.ipAddress }),
            ...(ctx.body.userAgent === null ? {} : { userAgent: ctx.body.userAgent }),
          } as never,
          true,
        )
        // null when the session hook refused it (a disabled or anonymized account), whatever
        // the declared type says
        const opened = session as typeof session | null
        if (!opened) throw new Error('activation session refused')
        await setSessionCookie(ctx, { session: opened, user })
        return ctx.json({ ok: true })
      },
    ),
  },
}

/** Sessions last 12 hours without use; the 30-day limit is ours (see auth-adapter.ts). */
const SESSION_IDLE_SECONDS = SESSION_IDLE_MS / 1000

export function createBetterAuth(deps: BetterAuthDeps) {
  const panel = new URL(deps.config.panelUrl)
  const origin = panel.origin
  const hooks = {
    db: deps.db,
    clock: deps.clock,
    rateLimiter: deps.rateLimiter,
    events: deps.events,
    logger: deps.logger,
    resolveSessionUser: deps.resolveSessionUser,
  }

  return betterAuth({
    baseURL: origin,
    basePath: '/api/auth',
    secret: deps.config.secret,
    secrets: deps.config.secrets,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    disabledPaths: ['/sign-up/email', '/update-user', '/delete-user'],
    user: { deleteUser: { enabled: false } },
    database: drizzleAdapter(deps.db, { provider: 'pg', usePlural: true, schema }),
    advanced: {
      // With `true` the name would become `__Secure-__Host-session` (ADR 012, V5).
      useSecureCookies: false,
      cookies: { ...COOKIE_NAMES },
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-app-client-ip'] },
      database: { generateId: () => deps.ids.newId() },
    },
    // Our own counters answer the per-IP limits (rate-limits.ts), shared between processes.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: (plain) => deps.hasher.hash(plain),
        verify: ({ hash, password }) => deps.hasher.verify(hash, password),
      },
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        try {
          // the handler checks the account again and sends nothing for a disabled one
          await deps.queue.send('identity.password_reset_email', { userId: user.id, url })
        } catch (error) {
          // A failure must not answer differently from an unknown email (account enumeration);
          // the link is a secret: never in the log.
          const reason = error instanceof Error ? error.message.split(url).join('[REDACTED]') : ''
          deps.logger.error({ reason }, 'password reset email not queued')
        }
      },
    },
    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 300,
      freshAge: 0,
      cookieCache: { enabled: false },
      additionalFields: {
        authMethod: { type: 'string', defaultValue: 'password', input: false },
        reauthenticatedAt: { type: 'date', required: false, input: false },
      },
    },
    plugins: [
      twoFactor({
        issuer: deps.config.productName,
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
        allowPasswordless: true,
      }),
      passkey({
        rpID: panel.hostname,
        rpName: deps.config.productName,
        origin,
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
        // The library asks for verification only as "preferred" when signing in. A passkey
        // without the PIN or the screen lock is one factor: it must not satisfy 2FA or a reauth.
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified)
              throw new APIError('UNAUTHORIZED', {
                message: 'Conferma la passkey con il PIN, il volto o l’impronta',
                code: 'USER_VERIFICATION_REQUIRED',
              })
            return Promise.resolve()
          },
        },
      }),
      activationSession,
    ],
    hooks: {
      before: createBeforeHook(hooks),
      after: createAfterHook(hooks),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!(await mayOpenSession(deps.db, session.userId))) {
              deps.logger.info({ path: ctx?.path }, 'session refused for a disabled account')
              return false
            }
            // A session replaced by an endpoint (2FA changes, password change) keeps its
            // method and its 30-day start. Typed here because the hook context is loose.
            const current = ctx?.context.session as
              | { user: { id: string }; session: { authMethod: AuthMethod; createdAt: Date } }
              | null
              | undefined
            // Never inherit on a first-factor sign-in, nor from another person's session (a
            // shared browser): the new session starts its own 30 days.
            const previous =
              current?.user.id === session.userId && !STARTS_NEW_SESSION.has(ctx?.path ?? '')
                ? current
                : null
            const method =
              ctx?.path === OPEN_SESSION_PATH
                ? 'activation'
                : (authMethodForPath(ctx?.path) ?? previous?.session.authMethod)
            if (method === undefined) return false
            return {
              data: {
                ...session,
                authMethod: method,
                ...(previous ? { createdAt: previous.session.createdAt } : {}),
              },
            }
          },
        },
      },
    },
  })
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>
