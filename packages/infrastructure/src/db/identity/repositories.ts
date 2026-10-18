import { and, eq, sql } from 'drizzle-orm'
import type { SessionsRepository, UserRecord, UsersRepository } from '@app/application'
import type { AuthMethod } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { sessions, users } from './schema.js'

// users and sessions have no row level security (personal data, not an agency's): every
// query names the user it is about, and only the identity module may import this file.

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  nickname: users.nickname,
  image: users.image,
  avatarKey: users.avatarKey,
  platformRole: users.platformRole,
  status: users.status,
  twoFactorEnabled: users.twoFactorEnabled,
  theme: users.theme,
  locale: users.locale,
  timezone: users.timezone,
  lastOrganizationId: users.lastOrganizationId,
  lastLoginAt: users.lastLoginAt,
  disabledAt: users.disabledAt,
  anonymizedAt: users.anonymizedAt,
  createdAt: users.createdAt,
}

type UserRow = Pick<typeof users.$inferSelect, keyof typeof userColumns>

// The check constraints keep the text columns inside these unions.
const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  name: row.name,
  nickname: row.nickname,
  image: row.image,
  avatarKey: row.avatarKey,
  platformRole: row.platformRole === 'admin' ? 'admin' : null,
  status: row.status as UserRecord['status'],
  twoFactorEnabled: row.twoFactorEnabled === true,
  theme: row.theme as UserRecord['theme'],
  locale: row.locale,
  timezone: row.timezone,
  lastOrganizationId: row.lastOrganizationId,
  lastLoginAt: row.lastLoginAt,
  disabledAt: row.disabledAt,
  anonymizedAt: row.anonymizedAt,
  createdAt: row.createdAt,
})

export function drizzleUsers(db: DbExecutor): UsersRepository {
  return {
    async findByEmail(email) {
      const [row] = await db.select(userColumns).from(users).where(eq(users.email, email))
      return row ? toUser(row) : null
    },
    async findByIdForUpdate(id) {
      const [row] = await db.select(userColumns).from(users).where(eq(users.id, id)).for('update')
      return row ? toUser(row) : null
    },
    async sharesOrganization(a, b) {
      const { rows } = await db.execute<{ shares: boolean }>(
        sql`select shares_active_organization(${a}, ${b}) as shares`,
      )
      return rows[0]?.shares === true
    },
  }
}

export function drizzleSessions(db: DbExecutor): SessionsRepository {
  const ofUser = (userId: string, sessionId: string) =>
    and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
  return {
    async findForUser(userId) {
      const rows = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
          expiresAt: sessions.expiresAt,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
          authMethod: sessions.authMethod,
          reauthenticatedAt: sessions.reauthenticatedAt,
        })
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(sessions.createdAt)
      return rows.map((row) => ({ ...row, authMethod: row.authMethod as AuthMethod }))
    },
    async setReauthenticated(userId, sessionId, at) {
      await db.update(sessions).set({ reauthenticatedAt: at }).where(ofUser(userId, sessionId))
    },
    async setAuthMethod(userId, sessionId, method) {
      await db.update(sessions).set({ authMethod: method }).where(ofUser(userId, sessionId))
    },
  }
}
