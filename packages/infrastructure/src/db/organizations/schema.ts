import { sql } from 'drizzle-orm'
import type { OrgRole } from '@app/domain'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { bytea, citext, createdAt, inList, tz, updatedAt } from '../columns.js'
import { users } from '../identity/schema.js'

export const ORG_ROLES = ['owner', 'admin', 'member'] as const satisfies readonly OrgRole[]
export const INVITE_PURPOSES = ['bootstrap', 'invite', 'organization_owner'] as const

// Row level security, grants and functions for these tables are hand-written at the end of
// migration 0002: drizzle-kit does not manage them.

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status').default('active').notNull(),
    limits: jsonb('limits').default({}).notNull(),
    settings: jsonb('settings').default({}).notNull(),
    suspendedAt: tz('suspended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('organizations_status', inList('status', ['active', 'suspended']))],
)

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    status: text('status').default('active').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    // RLS policies and the cross-agency functions look memberships up by user
    index('organization_members_user_id_idx').on(t.userId),
    uniqueIndex('organization_members_one_owner')
      .on(t.organizationId)
      .where(sql`role = 'owner'`),
    check('organization_members_role', inList('role', ORG_ROLES)),
    check('organization_members_status', inList('status', ['active', 'disabled'])),
  ],
)

export const organizationKeys = pgTable(
  'organization_keys',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    version: integer('version').notNull(),
    // Encrypted with the platform key, `v1.<keyVersion>.…` (Task 6)
    keyEnc: text('key_enc').notNull(),
    createdAt: createdAt(),
    retiredAt: tz('retired_at'),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.version] })],
)

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    purpose: text('purpose').notNull(),
    email: citext('email').notNull(),
    // No foreign keys to users: they belong to the identity module and the invite outlives them.
    existingUserId: uuid('existing_user_id'),
    reservedUserId: uuid('reserved_user_id'),
    tokenHash: bytea('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by'),
    orgRole: text('org_role'),
    memberships: jsonb('memberships').default([]).notNull(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('invites_organization_id_idx').on(t.organizationId),
    check('invites_purpose', inList('purpose', INVITE_PURPOSES)),
    check('invites_org_role', sql`${t.orgRole} is null or ${inList('org_role', ORG_ROLES)}`),
    check(
      'invites_organization_only_bootstrap_without',
      sql`${t.organizationId} is not null or ${t.purpose} = 'bootstrap'`,
    ),
    check(
      'invites_existing_or_reserved_user',
      sql`${t.existingUserId} is null or ${t.reservedUserId} is null`,
    ),
  ],
)
