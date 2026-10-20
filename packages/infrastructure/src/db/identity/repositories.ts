import { and, count, eq, inArray, sql } from 'drizzle-orm'
import type {
  KnownDevicesRepository,
  SessionsRepository,
  UserRecord,
  UsersRepository,
} from '@app/application'
import type { AuthMethod } from '@app/domain'
import type { DbExecutor } from '../client.js'
import type { TxContext } from '../tx-context.js'
import { knownDevices, passkeys, sessions, users } from './schema.js'

// users and sessions have no row level security (personal data, not an agency's): every
// query names the user it is about. Only the identity module may import this file (enforced by
// dependency-cruiser from Task 7b).

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

// Personal tables have no row level security: outside the system scope a user reaches only their
// own rows, whatever id the caller passes.
function ownUser(ctx: TxContext, userId: string): string {
  if (ctx.kind !== 'system' && ctx.userId !== userId) {
    throw new Error('personal data of another user is reachable only in the system scope')
  }
  return userId
}

export function drizzleUsers(db: DbExecutor, ctx: TxContext): UsersRepository {
  return {
    async findById(id) {
      const [row] = await db.select(userColumns).from(users).where(eq(users.id, id))
      return row ? toUser(row) : null
    },
    async summaries(ids) {
      if (ids.length === 0) return []
      const list = [...ids]
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          nickname: users.nickname,
          avatarKey: users.avatarKey,
          status: users.status,
          anonymizedAt: users.anonymizedAt,
          lastLoginAt: users.lastLoginAt,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(inArray(users.id, list))
      // only how many: never a key or a credential id
      const counts = await db
        .select({ userId: passkeys.userId, n: count() })
        .from(passkeys)
        .where(inArray(passkeys.userId, list))
        .groupBy(passkeys.userId)
      const passkeysOf = new Map(counts.map((c) => [c.userId, c.n]))
      return rows.map((row) => ({
        ...row,
        status: row.status as UserRecord['status'],
        twoFactorEnabled: row.twoFactorEnabled === true,
        passkeys: passkeysOf.get(row.id) ?? 0,
      }))
    },
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
    async setLastLoginAt(id, at) {
      await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, id))
    },
    async disable(id, at) {
      const changed = await db
        .update(users)
        .set({ status: 'disabled', disabledAt: at })
        .where(and(eq(users.id, id), eq(users.status, 'active')))
        .returning({ id: users.id })
      return changed.length > 0
    },
    async platformAdminExists() {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.platformRole, 'admin'))
        .limit(1)
      return row !== undefined
    },
    async setPlatformAdmin(id) {
      if (ctx.kind !== 'system') throw new Error('platform roles change only in the system scope')
      await db.update(users).set({ platformRole: 'admin' }).where(eq(users.id, id))
    },
    async setNickname(id, nickname) {
      await db
        .update(users)
        .set({ nickname })
        .where(eq(users.id, ownUser(ctx, id)))
    },
    async setLastOrganization(id, organizationId) {
      await db
        .update(users)
        .set({ lastOrganizationId: organizationId })
        .where(eq(users.id, ownUser(ctx, id)))
    },
    async countPasskeys(id) {
      const [row] = await db
        .select({ n: count() })
        .from(passkeys)
        .where(eq(passkeys.userId, ownUser(ctx, id)))
      return row?.n ?? 0
    },
  }
}

export function drizzleSessions(db: DbExecutor, ctx: TxContext): SessionsRepository {
  const ofUser = (userId: string, sessionId: string) =>
    and(eq(sessions.id, sessionId), eq(sessions.userId, ownUser(ctx, userId)))
  return {
    async findForUser(userId) {
      ownUser(ctx, userId)
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
      const updated = await db
        .update(sessions)
        .set({ reauthenticatedAt: at })
        .where(ofUser(userId, sessionId))
        .returning({ id: sessions.id })
      return updated.length > 0
    },
    async setAuthMethod(userId, sessionId, method) {
      await db.update(sessions).set({ authMethod: method }).where(ofUser(userId, sessionId))
    },
    async delete(userId, sessionId) {
      const deleted = await db
        .delete(sessions)
        .where(ofUser(userId, sessionId))
        .returning({ id: sessions.id })
      return deleted.length > 0
    },
    async deleteAllForUser(userId) {
      const deleted = await db
        .delete(sessions)
        .where(eq(sessions.userId, ownUser(ctx, userId)))
        .returning({ id: sessions.id })
      return deleted.length
    },
  }
}

// Same rule as sessions: known devices are personal and reachable only for the scope's user.
export function drizzleKnownDevices(db: DbExecutor, ctx: TxContext): KnownDevicesRepository {
  return {
    async count(userId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(knownDevices)
        .where(eq(knownDevices.userId, ownUser(ctx, userId)))
      return row?.n ?? 0
    },
    async touch(userId, deviceHash, at) {
      // xmax = 0 only on a freshly inserted row: tells an insert from an update in one statement
      const [row] = await db
        .insert(knownDevices)
        .values({ userId: ownUser(ctx, userId), deviceHash, firstSeenAt: at, lastSeenAt: at })
        .onConflictDoUpdate({
          target: [knownDevices.userId, knownDevices.deviceHash],
          set: { lastSeenAt: at },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` })
      return row?.inserted === true
    },
  }
}
