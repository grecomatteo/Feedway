import { eq, inArray, sql } from 'drizzle-orm'
import type { Clock, IdGenerator, RateLimiter } from '@app/application'
import type { DbExecutor } from './client.js'
import { rateLimits } from './identity/schema.js'

// Better Auth's own table: our keys start with `app:` so they never meet the library's.
const hitKey = (key: string) => `app:${key}`
const failureKey = (key: string) => `app:failures:${key}`

/**
 * Counters on the `rate_limits` table, so every web and worker process shares them. For hits
 * `last_request` holds the start of the current fixed window (epoch ms); for failures, the
 * time of the last one.
 */
export function createPgRateLimiter(deps: {
  db: DbExecutor
  clock: Clock
  ids: IdGenerator
}): RateLimiter {
  const { db, clock, ids } = deps
  return {
    async hit(key, limit, windowMs) {
      const now = clock.now().getTime()
      const expired = sql`${rateLimits.lastRequest} <= ${now - windowMs}`
      const [row] = await db
        .insert(rateLimits)
        .values({ id: ids.newId(), key: hitKey(key), count: 1, lastRequest: now })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
            lastRequest: sql`case when ${expired} then ${now} else ${rateLimits.lastRequest} end`,
          },
        })
        .returning({ count: rateLimits.count, windowStart: rateLimits.lastRequest })
      if (!row) throw new Error('rate limit upsert returned no row')
      if (row.count <= limit) return { allowed: true, retryAfterMs: 0 }
      return { allowed: false, retryAfterMs: Math.max(0, row.windowStart + windowMs - now) }
    },
    async failures(key) {
      const [row] = await db
        .select({ count: rateLimits.count, lastRequest: rateLimits.lastRequest })
        .from(rateLimits)
        .where(eq(rateLimits.key, failureKey(key)))
      return row
        ? { count: row.count, lastAt: new Date(row.lastRequest) }
        : { count: 0, lastAt: null }
    },
    async recordFailure(key) {
      const now = clock.now().getTime()
      await db
        .insert(rateLimits)
        .values({ id: ids.newId(), key: failureKey(key), count: 1, lastRequest: now })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: { count: sql`${rateLimits.count} + 1`, lastRequest: now },
        })
    },
    async reset(key) {
      await db.delete(rateLimits).where(inArray(rateLimits.key, [hitKey(key), failureKey(key)]))
    },
  }
}
