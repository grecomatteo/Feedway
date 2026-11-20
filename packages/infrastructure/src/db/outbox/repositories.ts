import type { IdGenerator, Outbox } from '@app/application'
import type { DbExecutor } from '../client.js'
import { outboxEvents } from './schema.js'

export function drizzleOutbox(db: DbExecutor, ids: IdGenerator): Outbox {
  return {
    async record(event) {
      await db.insert(outboxEvents).values({
        id: ids.newId(),
        organizationId: event.organizationId,
        type: event.type,
        payload: event.payload,
      })
    },
  }
}
