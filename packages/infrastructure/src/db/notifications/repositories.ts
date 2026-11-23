import type {
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
  type Weekday,
} from '@app/domain'
import { and, eq, sql } from 'drizzle-orm'
import type { DbExecutor } from '../client.js'
import {
  notificationDeliveries,
  notificationPrefs,
  notificationSettings,
  notifications,
  telegramLinks,
} from './schema.js'

export function drizzleNotifications(db: DbExecutor, ids: IdGenerator): NotificationsRepository {
  return {
    async create({ deliveries, ...n }) {
      const [row] = await db
        .insert(notifications)
        .values({ id: ids.newId(), ...n })
        .onConflictDoNothing({ target: [notifications.userId, notifications.eventId] })
        .returning({ id: notifications.id })
      if (!row) return false
      if (deliveries.length > 0)
        await db.insert(notificationDeliveries).values(
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
      return true
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

export function drizzleNotificationPrefs(db: DbExecutor): NotificationPrefsRepository {
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
