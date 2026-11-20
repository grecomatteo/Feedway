import { OUTBOX_EVENT_TYPES } from '@app/domain'
import { index, jsonb, pgTable, text, uuid, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createdAt, inList, tz, updatedAt } from '../columns.js'
import { organizations } from '../organizations/schema.js'

/**
 * What happened, written in the transaction of the change and sent later (§12.2, §13): the
 * notifications of stage 8 read it. `organization_id` null: an event of the platform, seen only
 * in the system scope.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    type: text('type').notNull(),
    // ids and codes only (`OutboxPayload`)
    payload: jsonb('payload').notNull().default({}),
    dispatchedAt: tz('dispatched_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // what is still to send, oldest first
    index('outbox_events_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
    index('outbox_events_organization_idx').on(t.organizationId, t.createdAt),
    check('outbox_events_type', inList('type', OUTBOX_EVENT_TYPES)),
  ],
)
