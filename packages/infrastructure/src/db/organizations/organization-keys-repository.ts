import { and, eq, isNull } from 'drizzle-orm'
import type { OrganizationKeysRepository } from '@app/application'
import type { DbExecutor } from '../client.js'
import { organizationKeys } from './schema.js'

// Every query names the organization even though RLS already limits the rows: two barriers.
export function drizzleOrganizationKeys(db: DbExecutor): OrganizationKeysRepository {
  return {
    async list(organizationId) {
      return db
        .select({
          version: organizationKeys.version,
          keyEnc: organizationKeys.keyEnc,
          retiredAt: organizationKeys.retiredAt,
        })
        .from(organizationKeys)
        .where(eq(organizationKeys.organizationId, organizationId))
        .orderBy(organizationKeys.version)
    },
    async insert(organizationId, version, keyEnc) {
      await db.insert(organizationKeys).values({ organizationId, version, keyEnc })
    },
    async retire(organizationId, version, at) {
      await db
        .update(organizationKeys)
        .set({ retiredAt: at })
        .where(
          and(
            eq(organizationKeys.organizationId, organizationId),
            eq(organizationKeys.version, version),
            isNull(organizationKeys.retiredAt),
          ),
        )
    },
  }
}
