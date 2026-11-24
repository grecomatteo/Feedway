import type { IdGenerator, Outbox } from '@app/application'
import type { OutboxEventType, OutboxPayload } from '@app/domain'
import { and, asc, desc, inArray, isNull, sql } from 'drizzle-orm'
import type { DbExecutor } from '../client.js'
import type { TxContext } from '../tx-context.js'
import { outboxEvents } from './schema.js'

type Row = typeof outboxEvents.$inferSelect

const pendingOf = (r: Row) => ({
  id: r.id,
  organizationId: r.organizationId,
  // the check constraint holds the list
  type: r.type as OutboxEventType,
  payload: r.payload as OutboxPayload,
  ...(r.dedupeKey === null ? {} : { dedupeKey: r.dedupeKey }),
  createdAt: r.createdAt,
})

function assertSystem(ctx: TxContext, what: string): void {
  if (ctx.kind !== 'system') throw new Error(`${what} only in the system scope`)
}

export function drizzleOutbox(db: DbExecutor, ids: IdGenerator, ctx: TxContext): Outbox {
  return {
    async record(event) {
      const rows = await db
        .insert(outboxEvents)
        .values({
          id: ids.newId(),
          organizationId: event.organizationId,
          type: event.type,
          payload: event.payload,
          dedupeKey: event.dedupeKey ?? null,
        })
        .onConflictDoNothing({
          target: [outboxEvents.organizationId, outboxEvents.dedupeKey],
          where: sql`${outboxEvents.dedupeKey} is not null`,
        })
        .returning({ id: outboxEvents.id })
      return rows.length > 0
    },

    async takePending(limit) {
      assertSystem(ctx, 'the outbox is read')
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.dispatchedAt))
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(limit)
        .for('update', { skipLocked: true })
      return rows.map(pendingOf)
    },

    async markDispatched(eventIds, at) {
      assertSystem(ctx, 'the outbox is marked')
      if (eventIds.length === 0) return
      await db
        .update(outboxEvents)
        .set({ dispatchedAt: at })
        .where(and(inArray(outboxEvents.id, [...eventIds]), isNull(outboxEvents.dispatchedAt)))
    },

    async recordDispatched(event, at) {
      assertSystem(ctx, 'an event already dispatched is written')
      const [row] = await db
        .insert(outboxEvents)
        .values({
          id: ids.newId(),
          organizationId: event.organizationId,
          type: event.type,
          payload: event.payload,
          dedupeKey: event.dedupeKey ?? null,
          dispatchedAt: at,
        })
        .onConflictDoNothing({
          target: [outboxEvents.organizationId, outboxEvents.dedupeKey],
          where: sql`${outboxEvents.dedupeKey} is not null`,
        })
        .returning()
      return row ? pendingOf(row) : null
    },

    async latestPlatform(types) {
      assertSystem(ctx, 'the outbox is read')
      if (types.length === 0) return null
      const [row] = await db
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.organizationId), inArray(outboxEvents.type, [...types])))
        .orderBy(desc(outboxEvents.createdAt), desc(outboxEvents.id))
        .limit(1)
      return row ? pendingOf(row) : null
    },
  }
}
