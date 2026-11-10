import { ACCOUNT_HEALTHS, CONNECTION_KINDS, CONNECTION_STATUSES, PLATFORMS } from '@app/domain'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { bytea, createdAt, inList, tz, updatedAt } from '../columns.js'
import { organizationMembers, organizations } from '../organizations/schema.js'
import { workspaces } from '../workspaces/schema.js'

// The accounts module (spec §8 and §13, ADR 019): generic, no platform's formats here.

/** How Feedway reaches some accounts: one token, sealed on the row (ADR 019). */
export const accountConnections = pgTable(
  'account_connections',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    // who the token belongs to on the platform: the same one again replaces the token (choice 4)
    externalUserId: text('external_user_id').notNull(),
    // information only: the connection stays when that person leaves the agency (choice 1)
    connectedBy: uuid('connected_by').notNull(),
    // sealed with the agency's data key, AAD `account_connections:<organizationId>:<id>`
    tokenEnc: text('token_enc').notNull(),
    keyVersion: integer('key_version').notNull(),
    // null: the token does not expire (system user)
    expiresAt: tz('expires_at'),
    status: text('status').notNull().default('pending'),
    lastRefreshedAt: tz('last_refreshed_at'),
    // the platform's usage counters at the last call; null: never measured
    lastUsage: jsonb('last_usage'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('account_connections_external_user').on(t.organizationId, t.kind, t.externalUserId),
    // target of the composite foreign key from social_accounts
    unique('account_connections_organization_id').on(t.organizationId, t.id),
    check('account_connections_kind', inList('kind', CONNECTION_KINDS)),
    check('account_connections_status', inList('status', CONNECTION_STATUSES)),
  ],
)

/** An account on a platform, imported by an agency; never deleted, only made inactive (§8.4). */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    username: text('username'),
    avatarUrl: text('avatar_url'),
    // the key of the profile (§3): a Facebook Page's own id, the Page of an Instagram, or null
    pageId: text('page_id'),
    // the owner (choice 2): only this connection syncs the account or makes it inactive
    connectionId: uuid('connection_id').notNull(),
    active: boolean('active').notNull().default(true),
    // null: never checked yet, so not selectable
    health: text('health'),
    healthMessage: text('health_message'),
    lastSyncedAt: tz('last_synced_at'),
    quotaUsed: integer('quota_used'),
    quotaTotal: integer('quota_total'),
    quotaCheckedAt: tz('quota_checked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // the same account may be in two agencies, once in each (§13)
    unique('social_accounts_external').on(t.organizationId, t.platform, t.externalId),
    // target of the composite foreign key from workspace_accounts
    unique('social_accounts_organization_id').on(t.organizationId, t.id),
    index('social_accounts_connection_idx').on(t.organizationId, t.connectionId),
    foreignKey({
      name: 'social_accounts_connection_fk',
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [accountConnections.organizationId, accountConnections.id],
    }),
    check('social_accounts_platform', inList('platform', PLATFORMS)),
    check('social_accounts_health', sql`health is null or ${inList('health', ACCOUNT_HEALTHS)}`),
    // a Page is its own profile key
    check(
      'social_accounts_facebook_page',
      sql`${t.platform} <> 'facebook' or ${t.pageId} = ${t.externalId}`,
    ),
    check(
      'social_accounts_quota',
      sql`(${t.quotaUsed} is null or ${t.quotaUsed} >= 0) and (${t.quotaTotal} is null or ${t.quotaTotal} >= 0)`,
    ),
  ],
)

/** Which accounts a workspace uses; an account may be in several workspaces of its agency. */
export const workspaceAccounts = pgTable(
  'workspace_accounts',
  {
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    accountId: uuid('account_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.accountId] }),
    index('workspace_accounts_account_idx').on(t.organizationId, t.accountId),
    foreignKey({
      name: 'workspace_accounts_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workspace_accounts_account_fk',
      columns: [t.organizationId, t.accountId],
      foreignColumns: [socialAccounts.organizationId, socialAccounts.id],
    }).onDelete('cascade'),
  ],
)

/**
 * A login started from the panel (choice 5): the `state` sent to the platform is
 * `<organizationId>.<random>`, and only the hash of the random part is kept. Valid once, for one
 * person, for 10 minutes.
 */
export const connectionAttempts = pgTable(
  'connection_attempts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    stateHash: bytea('state_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('connection_attempts_state').on(t.organizationId, t.stateHash),
    foreignKey({
      name: 'connection_attempts_member_fk',
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }).onDelete('cascade'),
    check('connection_attempts_kind', inList('kind', CONNECTION_KINDS)),
  ],
)
