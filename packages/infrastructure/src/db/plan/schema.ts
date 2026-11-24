import { PLAN_ITEM_TYPES, PLAN_TITLE_MAX_LENGTH } from '@app/domain'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, inList, updatedAt } from '../columns.js'
import { organizations } from '../organizations/schema.js'
import { workspaces } from '../workspaces/schema.js'

// The editorial plan (spec §11.12, §13; plan 09 Task 5). A content is a local date and an
// optional time of the agency's zone, never an instant. Its post is the one reference between
// modules the database allows: `post_id` with a composite key to `posts` and
// `ON DELETE SET NULL (post_id)`, written by hand in the migration (drizzle-kit has no column
// list for SET NULL), so a deleted post frees the content without touching `organization_id`.

export const planItems = pgTable(
  'plan_items',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    localTime: time('local_time'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    note: text('note').notNull().default(''),
    postId: uuid('post_id'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('plan_items_workspace_day_idx').on(t.organizationId, t.workspaceId, t.localDate),
    // rule 1: a post comes from one content at most
    uniqueIndex('plan_items_post_idx')
      .on(t.organizationId, t.postId)
      .where(sql`${t.postId} is not null`),
    foreignKey({
      name: 'plan_items_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('plan_items_type', inList('type', PLAN_ITEM_TYPES)),
    check(
      'plan_items_title',
      sql.raw(`char_length(title) between 1 and ${String(PLAN_TITLE_MAX_LENGTH)}`),
    ),
    check('plan_items_version', sql`${t.version} >= 1`),
  ],
)
