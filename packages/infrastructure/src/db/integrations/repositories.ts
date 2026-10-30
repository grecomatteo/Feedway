import { and, eq, isNull, sql } from 'drizzle-orm'
import type { IdGenerator, IntegrationRecord, IntegrationsRepository } from '@app/application'
import type { DbExecutor } from '../client.js'
import { integrations } from './schema.js'

type Row = typeof integrations.$inferSelect

const recordOf = (row: Row): IntegrationRecord => ({
  config: row.config,
  secretEnc: row.secretEnc,
  keyVersion: row.keyVersion,
  updatedBy: row.updatedBy,
  verifiedAt: row.verifiedAt,
  updatedAt: row.updatedAt,
})

/** The platform rows; row level security shows them only in the system scope. */
export function drizzleIntegrations(db: DbExecutor, ids: IdGenerator): IntegrationsRepository {
  return {
    async findPlatform(kind) {
      const [row] = await db
        .select()
        .from(integrations)
        .where(and(isNull(integrations.organizationId), eq(integrations.kind, kind)))
      return row ? recordOf(row) : null
    },
    async upsertPlatform(kind, input) {
      // new settings have not been tried yet
      const values = { ...input, verifiedAt: null }
      const [row] = await db
        .insert(integrations)
        .values({ id: ids.newId(), organizationId: null, kind, ...values })
        .onConflictDoUpdate({
          target: [integrations.organizationId, integrations.kind],
          set: { ...values, updatedAt: sql`now()` },
        })
        .returning()
      if (!row) throw new Error('integration not stored')
      return recordOf(row)
    },
  }
}
