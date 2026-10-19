import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import type { Clock, IdGenerator, Logger, PasswordHasher, RateLimiter } from '@app/application'
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
}

/** Sessions last 12 hours without use; the 30-day limit is ours (see auth-adapter.ts). */
const SESSION_IDLE_SECONDS = 43_200

export function createBetterAuth(deps: BetterAuthDeps) {
  const panel = new URL(deps.config.panelUrl)
  const origin = panel.origin
  const hooks = { db: deps.db, clock: deps.clock, rateLimiter: deps.rateLimiter }

  return betterAuth({
    baseURL: origin,
    basePath: '/api/auth',
    secret: deps.config.secret,
    secrets: deps.config.secrets,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
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
      // Mail is wired in Task 15; until then a reset request fails loudly instead of vanishing.
      sendResetPassword: () => {
        throw new Error('Invio del link di reset non ancora collegato (Task 15)')
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
      }),
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
            return {
              data: { ...session, authMethod: authMethodForPath(ctx?.path) ?? 'password' },
            }
          },
        },
      },
    },
  })
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>
