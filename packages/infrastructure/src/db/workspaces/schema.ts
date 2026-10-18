import {
  foreignKey,
  pgTable,
  primaryKey,
  text,
  time,
  unique,
  uuid,
  check,
} from 'drizzle-orm/pg-core'
import { WORKSPACE_ROLES } from '@app/domain'
import { createdAt, inList, tz, updatedAt } from '../columns.js'
import { organizationMembers, organizations } from '../organizations/schema.js'

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logoKey: text('logo_key'),
    // Local time; null means no default (§13)
    defaultPostTime: time('default_post_time'),
    archivedAt: tz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('workspaces_organization_slug').on(t.organizationId, t.slug),
    // Target of the composite foreign keys that keep children inside the same organization
    unique('workspaces_organization_id').on(t.organizationId, t.id),
  ],
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    foreignKey({
      name: 'workspace_members_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workspace_members_member_fk',
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }).onDelete('cascade'),
    check('workspace_members_role', inList('role', WORKSPACE_ROLES)),
  ],
)
