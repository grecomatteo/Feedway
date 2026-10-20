import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gt, ne } from 'drizzle-orm'
import type { Auth, Clock } from '@app/application'
import { isBeyondAbsoluteLifetime } from '@app/domain'
import { passkeys, sessions, users } from '../db/identity/schema.js'
import type { Db } from '../db/client.js'
import { toSessionInfo } from './auth-method.js'
import type { BetterAuthInstance } from './better-auth.js'
import { PANEL_RESET_TOKEN_PREFIX, PASSWORD_RESET_PAGE } from './auth-hooks.js'

export interface AuthAdapterDeps {
  db: Db
  clock: Clock
}

const MAX_PASSWORD_LENGTH = 128
/** As `resetPasswordTokenExpiresIn` (better-auth.ts). */
const RESET_LINK_TTL_MS = 3600_000

/**
 * The `Auth` port over Better Auth. Session lists and revocations work on our `sessions` table
 * directly, so a revocation takes effect at once on every process (no cookie cache).
 */
export function createAuthAdapter(instance: BetterAuthInstance, deps: AuthAdapterDeps): Auth {
  const { db, clock } = deps

  async function remove(sessionId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  }

  return {
    async getSession(headers) {
      const result = await instance.api.getSession({ headers })
      if (!result) return null
      const [row] = await db.select().from(sessions).where(eq(sessions.id, result.session.id))
      if (!row) return null
      const now = clock.now()
      if (row.expiresAt <= now || isBeyondAbsoluteLifetime(row.createdAt, now)) {
        await remove(row.id)
        return null
      }
      return { session: toSessionInfo(row), userId: row.userId }
    },

    handler(request) {
      return instance.handler(request)
    },

    async listSessions(userId) {
      const now = clock.now()
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
        .orderBy(desc(sessions.createdAt))
      return rows.filter((row) => !isBeyondAbsoluteLifetime(row.createdAt, now)).map(toSessionInfo)
    },

    async revokeSession(userId, sessionId) {
      const removed = await db
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .returning({ id: sessions.id })
      return removed.length > 0
    },

    async revokeAllSessions(userId, opts) {
      const keep = opts?.exceptSessionId
      const removed = await db
        .delete(sessions)
        .where(
          and(eq(sessions.userId, userId), keep === undefined ? undefined : ne(sessions.id, keep)),
        )
        .returning({ id: sessions.id })
      return removed.length
    },

    async verifyPassword(userId, password) {
      const ctx = await instance.$context
      const credential = await ctx.internalAdapter.findCredentialAccount(userId)
      // the same bound as sign-in: an endless input never reaches the hasher
      if (!credential?.password || password.length > MAX_PASSWORD_LENGTH) return false
      return ctx.password.verify({ hash: credential.password, password })
    },

    async createUser({ id, email, name, password }) {
      const ctx = await instance.$context
      const hash = password === null ? null : await ctx.password.hash(password)
      const existing = await ctx.internalAdapter.findUserById(id)
      if (!existing) {
        // ADR 012, V2: sign-up is closed, so the account is created here with our id
        await ctx.internalAdapter.createUser(
          { id, email, name, emailVerified: true },
          { method: 'admin' },
        )
      }
      if (hash === null) return
      const credential = await ctx.internalAdapter.findCredentialAccount(id)
      if (credential) await ctx.internalAdapter.updatePassword(id, hash)
      else
        await ctx.internalAdapter.linkAccount({
          userId: id,
          providerId: 'credential',
          accountId: id,
          password: hash,
        })
    },

    async openSession(userId, meta) {
      const opened = await instance.api.openActivationSession({
        body: { userId, ipAddress: meta.ip, userAgent: meta.userAgent },
        returnHeaders: true,
      })
      return { setCookie: opened.headers.getSetCookie() }
    },

    async passwordResetUrl(email) {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
      if (!user) return null
      // The token is ours, in the format `/reset-password` reads (ADR 012, V6), with a prefix the
      // library never produces (its tokens are letters and digits): the hook recognizes a link
      // copied from the panel and checks again, when it is used, that the person still works
      // for one agency only.
      const token = `${PANEL_RESET_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
      const ctx = await instance.$context
      await ctx.internalAdapter.createVerificationValue({
        identifier: `reset-password:${token}`,
        value: user.id,
        expiresAt: new Date(clock.now().getTime() + RESET_LINK_TTL_MS),
      })
      return `${ctx.baseURL}/reset-password/${token}?callbackURL=${encodeURIComponent(PASSWORD_RESET_PAGE)}`
    },

    async secondFactorStatus(userId) {
      const [user] = await db
        .select({ twoFactorEnabled: users.twoFactorEnabled })
        .from(users)
        .where(eq(users.id, userId))
      const rows = await db
        .select({
          id: passkeys.id,
          name: passkeys.name,
          createdAt: passkeys.createdAt,
          deviceType: passkeys.deviceType,
          backedUp: passkeys.backedUp,
        })
        .from(passkeys)
        .where(eq(passkeys.userId, userId))
        .orderBy(asc(passkeys.createdAt), asc(passkeys.id))
      return {
        totpEnabled: user?.twoFactorEnabled === true,
        passkeys: rows.map((row) => ({
          ...row,
          // the library writes only these two values
          deviceType: row.deviceType === 'multiDevice' ? 'multiDevice' : 'singleDevice',
        })),
      }
    },
  }
}
