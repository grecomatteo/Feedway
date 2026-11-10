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

// a JavaScript date holds milliseconds, the column microseconds
const sameVersion = (version: Date) =>
  sql`date_trunc('milliseconds', ${integrations.updatedAt}) = ${version.toISOString()}::timestamptz`

/**
 * The platform rows, which row level security shows only in the system scope, and the agency
 * rows, which it shows only inside their agency.
 */
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
    async markPlatformVerified(kind, at, version) {
      const rows = await db
        .update(integrations)
        // the column keeps its value: a successful test is not a change of the settings
        .set({ verifiedAt: at, updatedAt: sql`${integrations.updatedAt}` })
        .where(
          and(
            isNull(integrations.organizationId),
            eq(integrations.kind, kind),
            sameVersion(version),
          ),
        )
        .returning({ id: integrations.id })
      return rows.length > 0
    },

    async findForOrganization(organizationId, kind) {
      const [row] = await db
        .select()
        .from(integrations)
        .where(and(eq(integrations.organizationId, organizationId), eq(integrations.kind, kind)))
      return row ? recordOf(row) : null
    },

    async upsertForOrganization(organizationId, kind, input, expected) {
      if (expected === null) {
        // a row written by someone else since the read wins: nothing is overwritten
        const [row] = await db
          .insert(integrations)
          .values({ id: ids.newId(), organizationId, kind, ...input })
          .onConflictDoNothing({ target: [integrations.organizationId, integrations.kind] })
          .returning()
        return row ? recordOf(row) : null
      }
      const [row] = await db
        .update(integrations)
        .set({ ...input, updatedAt: sql`now()` })
        .where(
          and(
            eq(integrations.organizationId, organizationId),
            eq(integrations.kind, kind),
            sameVersion(expected),
          ),
        )
        .returning()
      return row ? recordOf(row) : null
    },

    async markVerified(organizationId, kind, at, version) {
      const rows = await db
        .update(integrations)
        .set({ verifiedAt: at, updatedAt: sql`${integrations.updatedAt}` })
        .where(
          and(
            eq(integrations.organizationId, organizationId),
            eq(integrations.kind, kind),
            sameVersion(version),
          ),
        )
        .returning({ id: integrations.id })
      return rows.length > 0
    },
  }
}
