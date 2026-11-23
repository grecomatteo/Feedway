import type { HeartbeatDetails, SystemHeartbeatsRepository } from '@app/application'
import { desc, lt, sql } from 'drizzle-orm'
import type { DbExecutor } from '../client.js'
import { systemHeartbeats } from './schema.js'
import type { TxContext } from '../tx-context.js'

function assertSystem(ctx: TxContext): void {
  if (ctx.kind !== 'system') throw new Error('the heartbeats only in the system scope')
}

function detailsOf(value: unknown): HeartbeatDetails | null {
  const v = value as { version?: unknown; queues?: unknown } | null
  return typeof v?.version === 'string' && typeof v.queues === 'number'
    ? { version: v.version, queues: v.queues }
    : null
}

export function drizzleHeartbeats(db: DbExecutor, ctx: TxContext): SystemHeartbeatsRepository {
  return {
    async beat({ process, instance, at, details }) {
      assertSystem(ctx)
      await db
        .insert(systemHeartbeats)
        .values({ process, instance, lastBeatAt: at, details })
        .onConflictDoUpdate({
          target: [systemHeartbeats.process, systemHeartbeats.instance],
          set: { lastBeatAt: at, details, updatedAt: sql`now()` },
        })
    },

    async list() {
      assertSystem(ctx)
      const rows = await db
        .select()
        .from(systemHeartbeats)
        .orderBy(desc(systemHeartbeats.lastBeatAt))
      return rows.map((r) => ({
        process: r.process,
        instance: r.instance,
        lastBeatAt: r.lastBeatAt,
        details: detailsOf(r.details),
      }))
    },

    async removeSilentSince(before) {
      assertSystem(ctx)
      const rows = await db
        .delete(systemHeartbeats)
        .where(lt(systemHeartbeats.lastBeatAt, before))
        .returning({ process: systemHeartbeats.process })
      return rows.length
    },
  }
}
