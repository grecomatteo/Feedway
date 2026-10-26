import { eq, inArray, sql } from 'drizzle-orm'
import type { Clock, RateLimiter } from '@app/application'
import type { DbExecutor } from './client.js'
import { rateLimitCounters } from './platform/schema.js'

const hitKey = (key: string) => `hits:${key}`
const failureKey = (key: string) => `failures:${key}`

/**
 * Counters on our own table, so every web and worker process shares them. For hits
 * `started_at` is the start of the current fixed window; for failures `updated_at` is the time
 * of the last one. Times come from the injected clock: all processes run on one host.
 */
export function createPgRateLimiter(deps: { db: DbExecutor; clock: Clock }): RateLimiter {
  const { db, clock } = deps
  const t = rateLimitCounters
  return {
    async hit(key, limit, windowMs) {
      const now = clock.now()
      const expired = sql`${t.startedAt} <= ${new Date(now.getTime() - windowMs)}`
      const [row] = await db
        .insert(t)
        .values({ key: hitKey(key), count: 1, startedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: t.key,
          set: {
            count: sql`case when ${expired} then 1 else ${t.count} + 1 end`,
            startedAt: sql`case when ${expired} then ${now} else ${t.startedAt} end`,
            updatedAt: now,
          },
        })
        .returning({ count: t.count, startedAt: t.startedAt })
      if (!row) throw new Error('rate limit upsert returned no row')
      if (row.count <= limit) return { allowed: true, retryAfterMs: 0 }
      const left = row.startedAt.getTime() + windowMs - now.getTime()
      return { allowed: false, retryAfterMs: Math.min(windowMs, Math.max(0, left)) }
    },
    async peek(key, limit, windowMs) {
      const now = clock.now()
      const [row] = await db
        .select({ count: t.count, startedAt: t.startedAt })
        .from(t)
        .where(eq(t.key, hitKey(key)))
      const left = row ? row.startedAt.getTime() + windowMs - now.getTime() : 0
      if (!row || left <= 0 || row.count < limit) return { allowed: true, retryAfterMs: 0 }
      return { allowed: false, retryAfterMs: Math.min(windowMs, left) }
    },
    async failures(key) {
      const [row] = await db
        .select({ count: t.count, lastAt: t.updatedAt })
        .from(t)
        .where(eq(t.key, failureKey(key)))
      return row ?? { count: 0, lastAt: null }
    },
    async recordFailure(key) {
      const now = clock.now()
      await db
        .insert(t)
        .values({ key: failureKey(key), count: 1, startedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: t.key, set: { count: sql`${t.count} + 1`, updatedAt: now } })
    },
    async reset(key) {
      await db.delete(t).where(inArray(t.key, [hitKey(key), failureKey(key)]))
    },
  }
}
