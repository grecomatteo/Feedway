import { eq, sql } from 'drizzle-orm'
import type { PlatformSettingsRepository } from '@app/application'
import type { DbExecutor } from '../client.js'
import { settings } from '../schema/settings.js'

export function drizzlePlatformSettings(db: DbExecutor): PlatformSettingsRepository {
  return {
    async set(key, value, updatedBy) {
      await db
        .insert(settings)
        .values({ key, value, updatedBy })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedBy, updatedAt: sql`now()` },
        })
    },
    async get(key) {
      const [row] = await db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
      return row?.value
    },
  }
}
