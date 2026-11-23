import type { IdGenerator, Outbox } from '@app/application'
import type { OutboxEventType, OutboxPayload } from '@app/domain'
import { and, asc, inArray, isNull, sql } from 'drizzle-orm'
import type { DbExecutor } from '../client.js'
import type { TxContext } from '../tx-context.js'
import { outboxEvents } from './schema.js'

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
          target: outboxEvents.dedupeKey,
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
      return rows.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        // the check constraint holds the list
        type: r.type as OutboxEventType,
        payload: r.payload as OutboxPayload,
        ...(r.dedupeKey === null ? {} : { dedupeKey: r.dedupeKey }),
        createdAt: r.createdAt,
      }))
    },

    async markDispatched(eventIds, at) {
      assertSystem(ctx, 'the outbox is marked')
      if (eventIds.length === 0) return
      await db
        .update(outboxEvents)
        .set({ dispatchedAt: at })
        .where(and(inArray(outboxEvents.id, [...eventIds]), isNull(outboxEvents.dispatchedAt)))
    },
  }
}
