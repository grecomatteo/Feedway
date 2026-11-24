import { INTEGRATION_KINDS } from '@app/application'
import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, inList, tz, updatedAt } from '../columns.js'
import { organizations } from '../organizations/schema.js'

// Settings of the integrations (spec §8.3, ADR 007 and 017). `organization_id` null is the
// platform's row, visible only in the system scope (migration 0006); an agency's row only inside
// that agency, its secret sealed with the agency's data key (Meta: ADR 019).
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    kind: text('kind').notNull(),
    // never the secret: SMTP host, port, security, username, sender; Meta App ID and the like
    config: jsonb('config').notNull(),
    // sealed with the agency's data key, or the platform key for the default
    secretEnc: text('secret_enc').notNull(),
    keyVersion: integer('key_version').notNull(),
    updatedBy: uuid('updated_by'),
    verifiedAt: tz('verified_at'),
    // the platform refused these settings (a test, or a job's call): until a save or a test works
    rejectedAt: tz('rejected_at'),
    // what the jobs keep between runs, never a secret: the `getUpdates` offset of a Telegram
    // bot, the last outcome of the external watch (plan 08 Task 4)
    state: jsonb('state').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // one row per agency and kind, and one platform default per kind (null counts as a value)
    unique('integrations_owner_kind').on(t.organizationId, t.kind).nullsNotDistinct(),
    // one place per Telegram bot, platform or agency: two pollers of one bot would split its
    // updates, and a `/start` could land in the wrong agency (plan 08 Task 7). An index sees
    // every row whatever the row level security.
    uniqueIndex('integrations_telegram_bot')
      .on(sql`(${t.config}->>'botId')`)
      .where(sql`${t.kind} = 'telegram'`),
    check('integrations_kind', inList('kind', INTEGRATION_KINDS)),
    // one SMTP for the whole installation, set by the platform administrator (ADR 017)
    check(
      'integrations_smtp_platform_only',
      sql`${t.kind} <> 'smtp' or ${t.organizationId} is null`,
    ),
    // each agency its own Meta app (ADR 019): no platform default
    check(
      'integrations_meta_agency_only',
      sql`${t.kind} <> 'meta' or ${t.organizationId} is not null`,
    ),
    // the external watch is of the whole installation (§16.7)
    check(
      'integrations_heartbeat_platform_only',
      sql`${t.kind} <> 'heartbeat' or ${t.organizationId} is null`,
    ),
  ],
)
