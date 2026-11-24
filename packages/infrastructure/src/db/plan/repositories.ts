import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { PlanItemRecord, PlanRepository, PlanScope } from '@app/application'
import type { PlanItemType } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { planItems } from './schema.js'

// The contents of the editorial plan (plan 09 Task 5): every query filters by the agency (and the
// workspace where it has one) in SQL too; row level security is the second barrier.

const columns = {
  id: planItems.id,
  organizationId: planItems.organizationId,
  workspaceId: planItems.workspaceId,
  localDate: planItems.localDate,
  // `HH:MM`, as the panel and the API write it
  localTime: sql<string | null>`to_char(${planItems.localTime}, 'HH24:MI')`,
  type: planItems.type,
  title: planItems.title,
  note: planItems.note,
  postId: planItems.postId,
  createdBy: planItems.createdBy,
  updatedBy: planItems.updatedBy,
  version: planItems.version,
  createdAt: planItems.createdAt,
  updatedAt: planItems.updatedAt,
}

type Row = Omit<PlanItemRecord, 'type'> & { type: string }
const toRecord = (r: Row): PlanItemRecord => ({ ...r, type: r.type as PlanItemType })

const inScope = (scope: PlanScope, id: string) =>
  and(
    eq(planItems.organizationId, scope.organizationId),
    eq(planItems.workspaceId, scope.workspaceId),
    eq(planItems.id, id),
  )

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function drizzlePlan(db: DbExecutor): PlanRepository {
  async function findOne(scope: PlanScope, id: string, forUpdate: boolean) {
    if (!UUID.test(id)) return null
    const query = db.select(columns).from(planItems).where(inScope(scope, id))
    const [row] = await (forUpdate ? query.for('update') : query)
    return row ? toRecord(row) : null
  }
  return {
    async listInRange(organizationId, workspaceIds, { from, to }) {
      if (workspaceIds.length === 0) return []
      const rows = await db
        .select(columns)
        .from(planItems)
        .where(
          and(
            eq(planItems.organizationId, organizationId),
            inArray(planItems.workspaceId, [...workspaceIds]),
            gte(planItems.localDate, from),
            lte(planItems.localDate, to),
          ),
        )
        // a content without a time goes after those of its day, as in the calendar
        .orderBy(
          asc(planItems.localDate),
          sql`${planItems.localTime} asc nulls last`,
          asc(planItems.id),
        )
      return rows.map(toRecord)
    },
    find: (scope, id) => findOne(scope, id, false),
    findForUpdate: (scope, id) => findOne(scope, id, true),
    async findByPostIds(organizationId, postIds) {
      const ids = postIds.filter((id) => UUID.test(id))
      if (ids.length === 0) return []
      const rows = await db
        .select(columns)
        .from(planItems)
        .where(and(eq(planItems.organizationId, organizationId), inArray(planItems.postId, ids)))
      return rows.map(toRecord)
    },
    async create(item) {
      const [row] = await db
        .insert(planItems)
        .values({ ...item, updatedBy: item.createdBy })
        .returning({ id: planItems.id })
      const created = row
        ? await findOne(
            { organizationId: item.organizationId, workspaceId: item.workspaceId },
            row.id,
            false,
          )
        : null
      if (!created) throw new Error('plan item not written')
      return created
    },
    async update(scope, id, change, expectedVersion) {
      if (!UUID.test(id)) return null
      const [row] = await db
        .update(planItems)
        .set({ ...change, version: sql`${planItems.version} + 1` })
        .where(and(inScope(scope, id), eq(planItems.version, expectedVersion)))
        .returning({ version: planItems.version })
      return row?.version ?? null
    },
    async remove(scope, id) {
      if (!UUID.test(id)) return false
      const rows = await db
        .delete(planItems)
        .where(inScope(scope, id))
        .returning({ id: planItems.id })
      return rows.length > 0
    },
    async linkPost(scope, id, postId, updatedBy) {
      if (!UUID.test(id)) return false
      const rows = await db
        .update(planItems)
        .set({ postId, updatedBy, version: sql`${planItems.version} + 1` })
        .where(inScope(scope, id))
        .returning({ id: planItems.id })
      return rows.length > 0
    },
  }
}
