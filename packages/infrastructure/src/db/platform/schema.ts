import { foreignKey, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { bytea, createdAt, tz, updatedAt } from '../columns.js'
import { organizationMembers, organizations } from '../organizations/schema.js'

// Prepared for personal API tokens (§18.3): table only, nothing uses it yet.
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    scopes: text('scopes').array().default([]).notNull(),
    expiresAt: tz('expires_at'),
    revokedAt: tz('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('api_tokens_organization_id_idx').on(t.organizationId),
    foreignKey({
      name: 'api_tokens_member_fk',
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }).onDelete('cascade'),
  ],
)

// Our request limits and failure counters (RateLimiter). Not Better Auth's rate_limits: the
// library prunes that table by age on its own, which would reset our account lockout.
// No agency data, so no RLS.
export const rateLimitCounters = pgTable('rate_limit_counters', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  // hits: start of the current fixed window; failures: time of the first one
  startedAt: tz('started_at').notNull(),
  updatedAt: tz('updated_at').notNull(),
})
