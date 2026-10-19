import { and, desc, eq, ne } from 'drizzle-orm'
import type { Auth, AuthSessionInfo, Clock } from '@app/application'
import { AUTH_METHODS, sessions } from '../db/identity/schema.js'
import type { Db } from '../db/client.js'
import type { BetterAuthInstance } from './better-auth.js'
import type { AuthMethod } from '@app/domain'

/** Absolute lifetime of a session, counted from `created_at` (spec §15.2). */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthAdapterDeps {
  db: Db
  clock: Clock
}

function toAuthMethod(value: string): AuthMethod {
  const found = AUTH_METHODS.find((method) => method === value)
  if (!found) throw new Error(`Metodo di accesso sconosciuto: ${value}`)
  return found
}

type SessionRow = typeof sessions.$inferSelect

function toInfo(row: SessionRow): AuthSessionInfo {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    authMethod: toAuthMethod(row.authMethod),
    reauthenticatedAt: row.reauthenticatedAt,
  }
}

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
      if (clock.now().getTime() - row.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
        await remove(row.id)
        return null
      }
      return { session: toInfo(row), userId: row.userId }
    },

    handler(request) {
      return instance.handler(request)
    },

    async listSessions(userId) {
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.createdAt))
      return rows.map(toInfo)
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
  }
}
