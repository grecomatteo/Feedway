import { CHANNELS, LEVELS, OUTBOX_EVENT_TYPES } from '@app/domain'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, inList, tz, updatedAt } from '../columns.js'
import { users } from '../identity/schema.js'
import { organizations } from '../organizations/schema.js'

// The notifications of stage 8 (§12, §13, plan 08 P1, P4, P6). Row level security is in the
// migration: an agency's rows in its scope, a person's own rows in their scope, all in the
// system's.

const HH_MM = sql.raw(`'^([01][0-9]|2[0-3]):[0-5][0-9]$'`)
export const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const

/** One row per person and event, in the notification centre. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    // null: an event of the platform
    organizationId: uuid('organization_id').references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // the outbox event; no foreign key, so old events can be pruned on their own (§6, D-37)
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    level: text('level').notNull(),
    workspaceId: uuid('workspace_id'),
    // ids and codes only, as the event's (P3)
    payload: jsonb('payload').notNull().default({}),
    readAt: tz('read_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // a dispatch run again writes nothing new
    unique('notifications_user_event').on(t.userId, t.eventId),
    // the bell and the centre: a person's newest first, the unread ones
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    index('notifications_organization_idx').on(t.organizationId, t.createdAt),
    check('notifications_kind', inList('kind', OUTBOX_EVENT_TYPES)),
    check('notifications_level', inList('level', LEVELS)),
  ],
)

/** One row per notification and channel; the delivery job sends one group of them (P1). */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    // the notification's, so a group is found without a join (P1)
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at'),
    // `sending` until then; past it, the dispatcher sends the job again (P2)
    claimedUntil: tz('claimed_until'),
    // a translated reason, never a secret or a provider's answer as it came
    error: text('error'),
    sentAt: tz('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('notification_deliveries_one_per_channel').on(t.notificationId, t.channel),
    // a group: the same person, agency, channel and kind, still to send (P1)
    index('notification_deliveries_group_idx')
      .on(t.userId, t.organizationId, t.channel, t.kind, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    // the dispatcher's sweep (P2): pending ones due, and claims left behind by a fallen process
    index('notification_deliveries_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('notification_deliveries_claimed_idx')
      .on(t.claimedUntil)
      .where(sql`${t.status} = 'sending'`),
    index('notification_deliveries_organization_idx').on(t.organizationId, t.createdAt),
    check('notification_deliveries_kind', inList('kind', OUTBOX_EVENT_TYPES)),
    check('notification_deliveries_channel', inList('channel', CHANNELS)),
    check('notification_deliveries_status', inList('status', DELIVERY_STATUSES)),
    check('notification_deliveries_attempts', sql`${t.attempts} >= 0`),
    check(
      'notification_deliveries_claim',
      sql`${t.status} <> 'sending' or ${t.claimedUntil} is not null`,
    ),
  ],
)

/** A person's channels for one kind, only where they changed something (P4). */
export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    // empty: the kind is off for them
    channels: text('channels').array().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'notification_prefs_pk', columns: [t.userId, t.kind] }),
    check('notification_prefs_kind', inList('kind', OUTBOX_EVENT_TYPES)),
    check(
      'notification_prefs_channels',
      sql.raw(`channels <@ array[${CHANNELS.map((c) => `'${c}'`).join(', ')}]::text[]`),
    ),
  ],
)

/** A person's settings for every kind (P4): one row, only once they change one. */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    minLevel: text('min_level').notNull().default('info'),
    // both or neither, `HH:MM` in the person's zone (Scelta 6)
    quietStart: text('quiet_start'),
    quietEnd: text('quiet_end'),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    digestTime: text('digest_time').notNull().default('08:00'),
    // ISO weekdays, 1 = Monday
    digestDays: smallint('digest_days')
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6,7}'`),
    everythingEverywhere: boolean('everything_everywhere').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('notification_settings_min_level', inList('min_level', LEVELS)),
    check(
      'notification_settings_quiet',
      sql`(${t.quietStart} is null) = (${t.quietEnd} is null)
          and (${t.quietStart} is null or (${t.quietStart} ~ ${HH_MM} and ${t.quietEnd} ~ ${HH_MM}))`,
    ),
    check('notification_settings_digest_time', sql`${t.digestTime} ~ ${HH_MM}`),
    check(
      'notification_settings_digest_days',
      sql`${t.digestDays} <@ '{1,2,3,4,5,6,7}'::smallint[]`,
    ),
  ],
)

/**
 * A person's Telegram chat with a bot (§12.3, plan 08 Scelta 8): `organization_id` null is the
 * platform's bot. The link code is kept only as its hash, for 15 minutes, once.
 */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // null until the person writes to the bot
    chatId: bigint('chat_id', { mode: 'bigint' }),
    linkedAt: tz('linked_at'),
    linkCodeHash: text('link_code_hash'),
    linkCodeExpiresAt: tz('link_code_expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // one link per person and bot (null counts as a value: the platform's bot)
    unique('telegram_links_bot_user').on(t.organizationId, t.userId).nullsNotDistinct(),
    uniqueIndex('telegram_links_code_idx')
      .on(t.linkCodeHash)
      .where(sql`${t.linkCodeHash} is not null`),
    index('telegram_links_user_idx').on(t.userId),
    index('telegram_links_organization_chat_idx').on(t.organizationId, t.chatId),
    check(
      'telegram_links_code',
      sql`(${t.linkCodeHash} is null) = (${t.linkCodeExpiresAt} is null)`,
    ),
    check('telegram_links_linked', sql`(${t.chatId} is null) = (${t.linkedAt} is null)`),
  ],
)

/**
 * The last beat of each process (§16.7, plan 08 P5). The platform's only, no agency data, so no
 * row level security (as `settings`).
 */
export const systemHeartbeats = pgTable(
  'system_heartbeats',
  {
    process: text('process').notNull(),
    instance: text('instance').notNull(),
    lastBeatAt: tz('last_beat_at').notNull(),
    // version, queues served: never a secret
    details: jsonb('details').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'system_heartbeats_pk', columns: [t.process, t.instance] }),
    index('system_heartbeats_last_beat_idx').on(t.lastBeatAt),
  ],
)
