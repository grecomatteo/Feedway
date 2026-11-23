import type {
  ClaimedDelivery,
  DeliveryRef,
  IdGenerator,
  NotificationPrefsRepository,
  NotificationsRepository,
  TelegramLinksRepository,
} from '@app/application'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type Channel,
  type Level,
  type OutboxEventType,
  type OutboxPayload,
  type Weekday,
} from '@app/domain'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbExecutor } from '../client.js'
import type { TxContext } from '../tx-context.js'
import {
  notificationDeliveries,
  notificationPrefs,
  notificationSettings,
  notifications,
  telegramLinks,
} from './schema.js'

function assertSystem(ctx: TxContext, what: string): void {
  if (ctx.kind !== 'system') throw new Error(`${what} only in the system scope`)
}

type DeliveryRow = {
  id: string
  organization_id: string | null
  user_id: string
  channel: string
  status: string
  attempts: number
  next_attempt_at: Date | string | null
}

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v))

const refOf = (r: DeliveryRow): DeliveryRef => ({
  id: r.id,
  organizationId: r.organization_id,
  userId: r.user_id,
  // the check constraints hold the lists
  channel: r.channel as Channel,
  status: r.status as DeliveryRef['status'],
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at === null ? null : toDate(r.next_attempt_at),
})

export function drizzleNotifications(
  db: DbExecutor,
  ids: IdGenerator,
  ctx: TxContext,
): NotificationsRepository {
  return {
    async create({ deliveries, ...n }) {
      const [row] = await db
        .insert(notifications)
        .values({ id: ids.newId(), ...n })
        .onConflictDoNothing({ target: [notifications.userId, notifications.eventId] })
        .returning({ id: notifications.id })
      if (!row) return null
      if (deliveries.length === 0) return []
      const written = await db
        .insert(notificationDeliveries)
        .values(
          deliveries.map((d) => ({
            id: ids.newId(),
            organizationId: n.organizationId,
            userId: n.userId,
            notificationId: row.id,
            kind: n.kind,
            channel: d.channel,
            status: d.status,
            nextAttemptAt: d.nextAttemptAt,
            error: d.error,
            sentAt: d.status === 'sent' ? sql`now()` : null,
          })),
        )
        .returning()
      return written.map((d) => ({
        id: d.id,
        organizationId: d.organizationId,
        userId: d.userId,
        channel: d.channel as Channel,
        status: d.status as DeliveryRef['status'],
        attempts: d.attempts,
        nextAttemptAt: d.nextAttemptAt,
      }))
    },

    async listDue(now, limit, only = 'all') {
      assertSystem(ctx, 'the deliveries due are read')
      const platform = only === 'platform' ? sql`and organization_id is null` : sql``
      const { rows } = await db.execute<DeliveryRow>(sql`
        select id, organization_id, user_id, channel, status, attempts, next_attempt_at
          from notification_deliveries
         where status = 'pending' and next_attempt_at <= ${now} ${platform}
         order by next_attempt_at, id
         limit ${limit}`)
      return rows.map(refOf)
    },

    async releaseExpiredClaims(now, { maxAttempts, gaveUp }) {
      assertSystem(ctx, 'the claims are released')
      // a group that keeps making its process fall stops at the attempts of a failure
      const { rows } = await db.execute<DeliveryRow>(sql`
        update notification_deliveries
           set status = case when attempts + 1 >= ${maxAttempts}::int then 'failed' else 'pending' end,
               error = case when attempts + 1 >= ${maxAttempts}::int then ${gaveUp}::text else error end,
               next_attempt_at = case when attempts + 1 >= ${maxAttempts}::int then null
                                      else ${now}::timestamptz end,
               claimed_until = null, attempts = attempts + 1, updated_at = now()
         where status = 'sending' and claimed_until < ${now}
        returning id, organization_id, user_id, channel, status, attempts, next_attempt_at`)
      return rows.filter((r) => r.status === 'pending').map(refOf)
    },

    async claimGroup({ deliveryId, userId, organizationId, now, claimedUntil }) {
      // one claim at a time per person and agency: the jobs of one group come due together, and
      // two workers that each locked their own row would split it in two messages (P1)
      await db.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended('notify:' || ${userId}::text || ':' ||
                           coalesce(${organizationId}::text, 'platform'), 0))`)
      // pg-boss starts a job by the database's clock: a worker a little behind it is not early
      const due = sql`greatest(${now}::timestamptz, now())`
      // the job's own row first: if another job of the group holds it, or took it, nothing to do
      const { rows: own } = await db.execute<{
        channel: string
        kind: string
      }>(sql`
        select channel, kind from notification_deliveries
         where id = ${deliveryId} and user_id = ${userId}
           and organization_id is not distinct from ${organizationId}::uuid
           and status = 'pending' and next_attempt_at <= ${due}
           for update skip locked`)
      const [first] = own
      if (!first) return []
      // the group (P1): the same person, agency, channel and kind; a row waiting for its retry
      // is not pulled forward, a first send joins
      const { rows } = await db.execute<{
        id: string
        notification_id: string
        kind: string
        channel: string
        attempts: number
        event_id: string
        workspace_id: string | null
        payload: OutboxPayload
        created_at: Date | string
      }>(sql`
        with taken as (
          select d.id from notification_deliveries d
           where d.user_id = ${userId}
             and d.organization_id is not distinct from ${organizationId}::uuid
             and d.channel = ${first.channel} and d.kind = ${first.kind}
             and d.status = 'pending'
             and (d.id = ${deliveryId} or d.attempts = 0 or d.next_attempt_at <= ${due})
           order by d.created_at, d.id
           for update skip locked
        )
        update notification_deliveries d
           set status = 'sending', claimed_until = ${claimedUntil}, updated_at = now()
          from taken, notifications n
         where d.id = taken.id and n.id = d.notification_id
        returning d.id, d.notification_id, d.kind, d.channel, d.attempts, n.event_id,
                  n.workspace_id, n.payload, n.created_at`)
      return rows
        .map((r): ClaimedDelivery => ({
          id: r.id,
          notificationId: r.notification_id,
          kind: r.kind as OutboxEventType,
          channel: r.channel as Channel,
          attempts: r.attempts,
          eventId: r.event_id,
          workspaceId: r.workspace_id,
          payload: r.payload,
          createdAt: toDate(r.created_at),
        }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    },

    async finishClaim(deliveryIds, claimedUntil, outcome) {
      if (deliveryIds.length === 0) return 0
      const set =
        outcome.status === 'sent'
          ? { status: 'sent', sentAt: sql`now()`, error: null, nextAttemptAt: null }
          : outcome.status === 'pending'
            ? {
                status: 'pending',
                attempts: sql`${notificationDeliveries.attempts} + 1`,
                nextAttemptAt: outcome.nextAttemptAt,
                error: outcome.error,
              }
            : { status: outcome.status, error: outcome.error, nextAttemptAt: null }
      const rows = await db
        .update(notificationDeliveries)
        .set({ ...set, claimedUntil: null })
        .where(
          and(
            inArray(notificationDeliveries.id, [...deliveryIds]),
            eq(notificationDeliveries.status, 'sending'),
            eq(notificationDeliveries.claimedUntil, claimedUntil),
          ),
        )
        .returning({ id: notificationDeliveries.id })
      return rows.length
    },

    async deleteAllForUser(userId) {
      // the deliveries go with their notification (on delete cascade)
      const rows = await db
        .delete(notifications)
        .where(eq(notifications.userId, userId))
        .returning({ id: notifications.id })
      return rows.length
    },
  }
}

export function drizzleNotificationPrefs(
  db: DbExecutor,
  ctx: TxContext,
): NotificationPrefsRepository {
  return {
    async getSettings(userId) {
      const [row] = await db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId))
      if (!row) return DEFAULT_NOTIFICATION_SETTINGS
      return {
        // the check constraints hold the lists
        minLevel: row.minLevel as Level,
        quietHours:
          row.quietStart !== null && row.quietEnd !== null
            ? { start: row.quietStart, end: row.quietEnd }
            : null,
        digest: {
          enabled: row.digestEnabled,
          time: row.digestTime,
          days: row.digestDays as Weekday[],
        },
        everythingEverywhere: row.everythingEverywhere,
      }
    },

    async saveSettings(userId, s) {
      const values = {
        minLevel: s.minLevel,
        quietStart: s.quietHours?.start ?? null,
        quietEnd: s.quietHours?.end ?? null,
        digestEnabled: s.digest.enabled,
        digestTime: s.digest.time,
        digestDays: [...s.digest.days],
        everythingEverywhere: s.everythingEverywhere,
      }
      await db
        .insert(notificationSettings)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: notificationSettings.userId, set: values })
    },

    async listPrefs(userId) {
      const rows = await db
        .select()
        .from(notificationPrefs)
        .where(eq(notificationPrefs.userId, userId))
      return new Map(
        rows.map((r) => [r.kind as OutboxEventType, { channels: r.channels as Channel[] }]),
      )
    },

    async setPref(userId, kind, pref) {
      if (pref === null) {
        await db
          .delete(notificationPrefs)
          .where(and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.kind, kind)))
        return
      }
      const channels = [...pref.channels]
      await db
        .insert(notificationPrefs)
        .values({ userId, kind, channels })
        .onConflictDoUpdate({
          target: [notificationPrefs.userId, notificationPrefs.kind],
          set: { channels },
        })
    },

    async deleteAllForUser(userId) {
      await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, userId))
      await db.delete(notificationSettings).where(eq(notificationSettings.userId, userId))
    },

    async listDigestSchedules(userIds) {
      assertSystem(ctx, 'listDigestSchedules')
      if (userIds.length === 0) return new Map()
      const rows = await db
        .select({
          userId: notificationSettings.userId,
          enabled: notificationSettings.digestEnabled,
          time: notificationSettings.digestTime,
          days: notificationSettings.digestDays,
        })
        .from(notificationSettings)
        .where(inArray(notificationSettings.userId, [...userIds]))
      return new Map(
        // the check constraint holds the days
        rows.map((r) => [
          r.userId,
          { enabled: r.enabled, time: r.time, days: r.days as Weekday[] },
        ]),
      )
    },
  }
}

export function drizzleTelegramLinks(db: DbExecutor): TelegramLinksRepository {
  return {
    async deleteAllForUser(userId) {
      const rows = await db
        .delete(telegramLinks)
        .where(eq(telegramLinks.userId, userId))
        .returning({ id: telegramLinks.id })
      return rows.length
    },
  }
}
