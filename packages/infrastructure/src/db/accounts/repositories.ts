import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  sql,
} from 'drizzle-orm'
import type {
  ConnectionAttemptsRepository,
  ConnectionRecord,
  ConnectionsRepository,
  ConnectionWithToken,
  IdGenerator,
  SocialAccountRecord,
  SocialAccountsRepository,
  WorkspaceAccountsRepository,
} from '@app/application'
import type { AccountHealth, ConnectionKind, ConnectionStatus, Platform } from '@app/domain'
import type { DbExecutor } from '../client.js'
import {
  accountConnections,
  connectionAttempts,
  socialAccounts,
  workspaceAccounts,
} from './schema.js'

// Every query filters by organization in SQL as well: row level security is the second barrier.

const accountColumns = {
  id: socialAccounts.id,
  organizationId: socialAccounts.organizationId,
  platform: socialAccounts.platform,
  externalId: socialAccounts.externalId,
  name: socialAccounts.name,
  username: socialAccounts.username,
  avatarUrl: socialAccounts.avatarUrl,
  pageId: socialAccounts.pageId,
  connectionId: socialAccounts.connectionId,
  active: socialAccounts.active,
  health: socialAccounts.health,
  healthMessage: socialAccounts.healthMessage,
  lastSyncedAt: socialAccounts.lastSyncedAt,
  quotaUsed: socialAccounts.quotaUsed,
  quotaTotal: socialAccounts.quotaTotal,
  quotaCheckedAt: socialAccounts.quotaCheckedAt,
  createdAt: socialAccounts.createdAt,
}

type AccountRow = { platform: string; health: string | null } & Omit<
  SocialAccountRecord,
  'platform' | 'health'
>

// the check constraints keep the values inside the lists
const accountOf = (row: AccountRow): SocialAccountRecord => ({
  ...row,
  platform: row.platform as Platform,
  health: row.health as AccountHealth | null,
})

/** The agency's accounts, or those assigned to one of `workspaceIds`; null: none at all. */
function accountsWhere(
  db: DbExecutor,
  organizationId: string,
  workspaceIds: readonly string[] | undefined,
) {
  if (workspaceIds?.length === 0) return null
  const inOrganization = eq(socialAccounts.organizationId, organizationId)
  if (!workspaceIds) return inOrganization
  return and(
    inOrganization,
    exists(
      db
        .select({ one: sql`1` })
        .from(workspaceAccounts)
        .where(
          and(
            eq(workspaceAccounts.organizationId, organizationId),
            eq(workspaceAccounts.accountId, socialAccounts.id),
            inArray(workspaceAccounts.workspaceId, [...workspaceIds]),
          ),
        ),
    ),
  )
}

export function drizzleSocialAccounts(db: DbExecutor, ids: IdGenerator): SocialAccountsRepository {
  return {
    async list(organizationId, filter = {}) {
      const where = accountsWhere(db, organizationId, filter.workspaceIds)
      if (where === null) return []
      const rows = await db
        .select(accountColumns)
        .from(socialAccounts)
        .where(where)
        .orderBy(asc(socialAccounts.name), asc(socialAccounts.id))
      return rows.map(accountOf)
    },
    async listPage(organizationId, page) {
      const where = accountsWhere(db, organizationId, page.workspaceIds)
      if (where === null) return []
      const rows = await db
        .select(accountColumns)
        .from(socialAccounts)
        .where(page.afterId === undefined ? where : and(where, gt(socialAccounts.id, page.afterId)))
        .orderBy(asc(socialAccounts.id))
        .limit(page.limit)
      return rows.map(accountOf)
    },
    async findById(organizationId, id) {
      const [row] = await db
        .select(accountColumns)
        .from(socialAccounts)
        .where(and(eq(socialAccounts.organizationId, organizationId), eq(socialAccounts.id, id)))
      return row ? accountOf(row) : null
    },
    async findByExternalIds(organizationId, platform, externalIds) {
      if (externalIds.length === 0) return []
      const rows = await db
        .select(accountColumns)
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.organizationId, organizationId),
            eq(socialAccounts.platform, platform),
            inArray(socialAccounts.externalId, [...externalIds]),
          ),
        )
      return rows.map(accountOf)
    },
    async countActive(organizationId) {
      const [row] = await db
        .select({ n: count() })
        .from(socialAccounts)
        .where(
          and(eq(socialAccounts.organizationId, organizationId), eq(socialAccounts.active, true)),
        )
      return row?.n ?? 0
    },
    async lockImport(organizationId) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`social_accounts:${organizationId}`}))`,
      )
    },
    async upsertImported(input) {
      const { at, ...account } = input
      const fields = {
        name: account.name,
        username: account.username,
        avatarUrl: account.avatarUrl,
        pageId: account.pageId,
        connectionId: account.connectionId,
        active: true,
        lastSyncedAt: at,
        // another owner has not checked it yet: "never checked" until its first check
        health: sql`case when ${socialAccounts.connectionId} = excluded.connection_id then ${socialAccounts.health} end`,
        healthMessage: sql`case when ${socialAccounts.connectionId} = excluded.connection_id then ${socialAccounts.healthMessage} end`,
      }
      const [row] = await db
        .insert(socialAccounts)
        .values({ id: ids.newId(), ...account, active: true, lastSyncedAt: at })
        .onConflictDoUpdate({
          target: [
            socialAccounts.organizationId,
            socialAccounts.platform,
            socialAccounts.externalId,
          ],
          set: { ...fields, updatedAt: sql`now()` },
        })
        .returning(accountColumns)
      if (!row) throw new Error('social account not stored')
      return accountOf(row)
    },
    async markInactive(organizationId, connectionId, accountIds) {
      if (accountIds.length === 0) return 0
      const rows = await db
        .update(socialAccounts)
        .set({ active: false })
        .where(
          and(
            eq(socialAccounts.organizationId, organizationId),
            inArray(socialAccounts.id, [...accountIds]),
            // an account another connection took over meanwhile is not this one's to close
            eq(socialAccounts.connectionId, connectionId),
            eq(socialAccounts.active, true),
          ),
        )
        .returning({ id: socialAccounts.id })
      return rows.length
    },
    async listOwnedBy(organizationId, connectionId) {
      const rows = await db
        .select(accountColumns)
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.organizationId, organizationId),
            eq(socialAccounts.connectionId, connectionId),
          ),
        )
        .orderBy(asc(socialAccounts.id))
      return rows.map(accountOf)
    },
    async updateFromPlatform(organizationId, connectionId, id, update) {
      const rows = await db
        .update(socialAccounts)
        .set({
          name: update.name,
          username: update.username,
          avatarUrl: update.avatarUrl,
          pageId: update.pageId,
          lastSyncedAt: update.at,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(socialAccounts.organizationId, organizationId),
            eq(socialAccounts.id, id),
            eq(socialAccounts.connectionId, connectionId),
            eq(socialAccounts.active, true),
          ),
        )
        .returning({ id: socialAccounts.id })
      return rows.length > 0
    },
    async setHealth(organizationId, connectionId, id, update) {
      const rows = await db
        .update(socialAccounts)
        .set({
          health: update.health,
          healthMessage: update.message,
          ...(update.quota !== null && {
            quotaUsed: update.quota.used,
            quotaTotal: update.quota.total,
            quotaCheckedAt: update.at,
          }),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(socialAccounts.organizationId, organizationId),
            eq(socialAccounts.id, id),
            eq(socialAccounts.connectionId, connectionId),
          ),
        )
        .returning({ id: socialAccounts.id })
      return rows.length > 0
    },
  }
}

const connectionColumns = {
  id: accountConnections.id,
  organizationId: accountConnections.organizationId,
  kind: accountConnections.kind,
  externalUserId: accountConnections.externalUserId,
  connectedBy: accountConnections.connectedBy,
  expiresAt: accountConnections.expiresAt,
  status: accountConnections.status,
  lastRefreshedAt: accountConnections.lastRefreshedAt,
  lastUsage: accountConnections.lastUsage,
  createdAt: accountConnections.createdAt,
  updatedAt: accountConnections.updatedAt,
}

type ConnectionRow = { kind: string; status: string } & Omit<ConnectionRecord, 'kind' | 'status'>

const connectionOf = <R extends ConnectionRow>(
  row: R,
): Omit<R, 'kind' | 'status'> & { kind: ConnectionKind; status: ConnectionStatus } => ({
  ...row,
  kind: row.kind as ConnectionKind,
  status: row.status as ConnectionStatus,
})

const connectionKey = (organizationId: string, id: string) =>
  and(eq(accountConnections.organizationId, organizationId), eq(accountConnections.id, id))

export function drizzleConnections(db: DbExecutor): ConnectionsRepository {
  return {
    async list(organizationId) {
      const rows = await db
        .select(connectionColumns)
        .from(accountConnections)
        .where(eq(accountConnections.organizationId, organizationId))
        .orderBy(asc(accountConnections.createdAt), asc(accountConnections.id))
      return rows.map(connectionOf)
    },
    async findById(organizationId, id) {
      const [row] = await db
        .select(connectionColumns)
        .from(accountConnections)
        .where(connectionKey(organizationId, id))
      return row ? connectionOf(row) : null
    },
    async findByExternalUser(organizationId, kind, externalUserId) {
      const [row] = await db
        .select(connectionColumns)
        .from(accountConnections)
        .where(
          and(
            eq(accountConnections.organizationId, organizationId),
            eq(accountConnections.kind, kind),
            eq(accountConnections.externalUserId, externalUserId),
          ),
        )
      return row ? connectionOf(row) : null
    },
    async findWithToken(organizationId, id, opts = {}) {
      const query = db
        .select({
          ...connectionColumns,
          tokenEnc: accountConnections.tokenEnc,
          keyVersion: accountConnections.keyVersion,
        })
        .from(accountConnections)
        .where(connectionKey(organizationId, id))
      const [row] = await (opts.forUpdate ? query.for('update') : query)
      return row ? (connectionOf(row) satisfies ConnectionWithToken) : null
    },
    async create(connection) {
      const [row] = await db
        .insert(accountConnections)
        .values({ ...connection, status: 'pending' })
        .returning(connectionColumns)
      if (!row) throw new Error('connection not stored')
      return connectionOf(row)
    },
    async replaceToken(organizationId, id, token) {
      const rows = await db
        .update(accountConnections)
        .set({
          tokenEnc: token.tokenEnc,
          keyVersion: token.keyVersion,
          expiresAt: token.expiresAt,
          status: token.status,
          lastRefreshedAt: token.at,
        })
        .where(connectionKey(organizationId, id))
        .returning({ id: accountConnections.id })
      return rows.length > 0
    },
    async setStatus(organizationId, id, status) {
      const rows = await db
        .update(accountConnections)
        .set({ status })
        .where(connectionKey(organizationId, id))
        .returning({ id: accountConnections.id })
      return rows.length > 0
    },
    async recordUsage(organizationId, id, usage) {
      await db
        .update(accountConnections)
        .set({ lastUsage: usage })
        .where(connectionKey(organizationId, id))
    },
    async deleteStalePending(organizationId, createdBefore) {
      const rows = await db
        .delete(accountConnections)
        .where(
          and(
            eq(accountConnections.organizationId, organizationId),
            eq(accountConnections.status, 'pending'),
            lt(accountConnections.createdAt, createdBefore),
            notExists(
              db
                .select({ id: socialAccounts.id })
                .from(socialAccounts)
                .where(
                  and(
                    eq(socialAccounts.organizationId, accountConnections.organizationId),
                    eq(socialAccounts.connectionId, accountConnections.id),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: accountConnections.id })
      return rows.length
    },
  }
}

export function drizzleConnectionAttempts(db: DbExecutor): ConnectionAttemptsRepository {
  return {
    async create(attempt) {
      await db.insert(connectionAttempts).values(attempt)
    },
    async consume(organizationId, kind, stateHash, userId, now) {
      // one statement: of two returns with the same state, only one finds the row unused
      const [row] = await db
        .update(connectionAttempts)
        .set({ usedAt: now })
        .where(
          and(
            eq(connectionAttempts.organizationId, organizationId),
            eq(connectionAttempts.kind, kind),
            eq(connectionAttempts.stateHash, stateHash),
            eq(connectionAttempts.userId, userId),
            isNull(connectionAttempts.usedAt),
            gt(connectionAttempts.expiresAt, now),
          ),
        )
        .returning({
          id: connectionAttempts.id,
          organizationId: connectionAttempts.organizationId,
          userId: connectionAttempts.userId,
          kind: connectionAttempts.kind,
          expiresAt: connectionAttempts.expiresAt,
          usedAt: connectionAttempts.usedAt,
        })
      return row ? { ...row, kind: row.kind as ConnectionKind } : null
    },
    async deleteExpired(organizationId, now) {
      const rows = await db
        .delete(connectionAttempts)
        .where(
          and(
            eq(connectionAttempts.organizationId, organizationId),
            lte(connectionAttempts.expiresAt, now),
          ),
        )
        .returning({ id: connectionAttempts.id })
      return rows.length
    },
  }
}

const assignment = (organizationId: string, workspaceId: string, accountId: string) =>
  and(
    eq(workspaceAccounts.organizationId, organizationId),
    eq(workspaceAccounts.workspaceId, workspaceId),
    eq(workspaceAccounts.accountId, accountId),
  )

export function drizzleWorkspaceAccounts(db: DbExecutor): WorkspaceAccountsRepository {
  return {
    async assign(organizationId, workspaceId, accountId) {
      const rows = await db
        .insert(workspaceAccounts)
        .values({ organizationId, workspaceId, accountId })
        .onConflictDoNothing({
          target: [
            workspaceAccounts.organizationId,
            workspaceAccounts.workspaceId,
            workspaceAccounts.accountId,
          ],
        })
        .returning({ accountId: workspaceAccounts.accountId })
      return rows.length > 0
    },
    async unassign(organizationId, workspaceId, accountId) {
      const rows = await db
        .delete(workspaceAccounts)
        .where(assignment(organizationId, workspaceId, accountId))
        .returning({ accountId: workspaceAccounts.accountId })
      return rows.length > 0
    },
    async listForWorkspace(organizationId, workspaceId) {
      const rows = await db
        .select({ accountId: workspaceAccounts.accountId })
        .from(workspaceAccounts)
        .where(
          and(
            eq(workspaceAccounts.organizationId, organizationId),
            eq(workspaceAccounts.workspaceId, workspaceId),
          ),
        )
        .orderBy(asc(workspaceAccounts.accountId))
      return rows.map((r) => r.accountId)
    },
    async listForAccounts(organizationId, accountIds) {
      if (accountIds.length === 0) return []
      return db
        .select({
          accountId: workspaceAccounts.accountId,
          workspaceId: workspaceAccounts.workspaceId,
        })
        .from(workspaceAccounts)
        .where(
          and(
            eq(workspaceAccounts.organizationId, organizationId),
            inArray(workspaceAccounts.accountId, [...accountIds]),
          ),
        )
        .orderBy(asc(workspaceAccounts.accountId), asc(workspaceAccounts.workspaceId))
    },
  }
}
