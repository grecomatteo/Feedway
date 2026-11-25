import { and, eq } from 'drizzle-orm'
import type { BulkImportRecord, BulkImportsRepository, BulkRow } from '@app/application'
import type { BulkSource, BulkStatus, BulkSummary } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { bulkImports } from './schema.js'

// The imports in bulk (spec §11.6, plan 09 Task 10). Every query filters by agency in SQL as
// well: row level security is the second barrier.

type Row = typeof bulkImports.$inferSelect

// the check constraints keep source and status in their lists; rows and summary are written only
// by this repository, from the application's types
const toRecord = (r: Row): BulkImportRecord => ({
  id: r.id,
  organizationId: r.organizationId,
  workspaceId: r.workspaceId,
  createdBy: r.createdBy,
  source: r.source as BulkSource,
  rows: r.rows as BulkRow[],
  status: r.status as BulkStatus,
  summary: r.summary as BulkSummary,
  createdAt: r.createdAt,
  finishedAt: r.finishedAt,
})

export function drizzleBulkImports(db: DbExecutor): BulkImportsRepository {
  return {
    async insert(record) {
      await db.insert(bulkImports).values({
        id: record.id,
        organizationId: record.organizationId,
        workspaceId: record.workspaceId,
        createdBy: record.createdBy,
        source: record.source,
        rows: record.rows,
        status: record.status,
        summary: record.summary,
        finishedAt: record.finishedAt,
      })
    },
    async find(scope, id) {
      const [row] = await db
        .select()
        .from(bulkImports)
        .where(
          and(
            eq(bulkImports.organizationId, scope.organizationId),
            eq(bulkImports.workspaceId, scope.workspaceId),
            eq(bulkImports.id, id),
          ),
        )
      return row ? toRecord(row) : null
    },
    async findForUpdate(organizationId, id) {
      const [row] = await db
        .select()
        .from(bulkImports)
        .where(and(eq(bulkImports.organizationId, organizationId), eq(bulkImports.id, id)))
        .for('update')
      return row ? toRecord(row) : null
    },
    async update(organizationId, id, change) {
      await db
        .update(bulkImports)
        .set({
          status: change.status,
          rows: change.rows,
          summary: change.summary,
          finishedAt: change.finishedAt,
        })
        .where(and(eq(bulkImports.organizationId, organizationId), eq(bulkImports.id, id)))
    },
    async deletePending(organizationId, id) {
      const deleted = await db
        .delete(bulkImports)
        .where(
          and(
            eq(bulkImports.organizationId, organizationId),
            eq(bulkImports.id, id),
            eq(bulkImports.status, 'pending'),
          ),
        )
        .returning({ id: bulkImports.id })
      return deleted.length > 0
    },
  }
}
