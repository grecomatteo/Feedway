import { and, asc, eq, gte, lt, notInArray, sql } from 'drizzle-orm'
import type { PostScope, TimeSlotsRepository } from '@app/application'
import type { Weekday } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { posts, timeSlots } from './schema.js'

// The usual times of a workspace (spec §11.6, plan 09 Task 9). Every query filters by agency and
// workspace in SQL as well: row level security is the second barrier.

const ofScope = (scope: PostScope) =>
  and(
    eq(timeSlots.organizationId, scope.organizationId),
    eq(timeSlots.workspaceId, scope.workspaceId),
  )

const key = (s: { weekday: number; localTime: string }) => `${String(s.weekday)} ${s.localTime}`

export function drizzleTimeSlots(db: DbExecutor): TimeSlotsRepository {
  async function list(scope: PostScope) {
    const rows = await db
      .select({
        weekday: timeSlots.weekday,
        localTime: sql<string>`to_char(${timeSlots.localTime}, 'HH24:MI')`,
      })
      .from(timeSlots)
      .where(ofScope(scope))
      .orderBy(asc(timeSlots.weekday), asc(timeSlots.localTime))
    // the check constraint keeps the weekday in 1–7
    return rows.map((r) => ({ weekday: r.weekday as Weekday, localTime: r.localTime }))
  }
  return {
    list,
    async replace(scope, slots) {
      // one replace at a time for the workspace: a second waits and reads the first's list
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`time_slots:${scope.workspaceId}`}))`,
      )
      const before = await list(scope)
      if (before.map(key).join(',') === slots.map(key).join(',')) return false
      await db.delete(timeSlots).where(ofScope(scope))
      if (slots.length > 0)
        await db.insert(timeSlots).values(
          slots.map((s) => ({
            id: s.id,
            organizationId: scope.organizationId,
            workspaceId: scope.workspaceId,
            weekday: s.weekday,
            localTime: s.localTime,
          })),
        )
      return true
    },
    async scheduledAt(scope, from, to) {
      const rows = await db
        .selectDistinct({ at: posts.scheduledAt })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, scope.organizationId),
            eq(posts.workspaceId, scope.workspaceId),
            // a scheduled post, or one on its way: a draft with a day takes no slot
            notInArray(posts.status, ['draft', 'cancelled']),
            gte(posts.scheduledAt, from),
            lt(posts.scheduledAt, to),
          ),
        )
      return rows.flatMap((r) => (r.at ? [r.at] : []))
    },
  }
}
