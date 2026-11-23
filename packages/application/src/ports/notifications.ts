import type {
  Channel,
  Level,
  NotificationPref,
  NotificationSettings,
  OutboxEventType,
  OutboxPayload,
} from '@app/domain'

/** The status a delivery is born with: the panel's is sent at once (plan 08 Task 5). */
export type NewDeliveryStatus = 'pending' | 'sent' | 'skipped'

/** One person's notification of one event, with a delivery per channel (§13, P1). */
export interface NewNotification {
  organizationId: string | null
  userId: string
  eventId: string
  kind: OutboxEventType
  level: Level
  workspaceId: string | null
  payload: OutboxPayload
  deliveries: readonly {
    channel: Channel
    status: NewDeliveryStatus
    /** pending: when the group is sent (`groupWindow`) */
    nextAttemptAt: Date | null
    /** skipped: why, translated, never a secret */
    error: string | null
  }[]
}

export interface NotificationsRepository {
  /**
   * Writes the notification and its deliveries. false: the person already has this event's
   * (a dispatch run again), nothing written.
   */
  create(notification: NewNotification): Promise<boolean>
  /**
   * The system scope only (anonymization, §10.4): every notification of the person in every
   * agency and the platform's, with their deliveries. Returns how many went.
   */
  deleteAllForUser(userId: string): Promise<number>
}

/** A person's choices (P4): without a row, the defaults. */
export interface NotificationPrefsRepository {
  getSettings(userId: string): Promise<NotificationSettings>
  saveSettings(userId: string, settings: NotificationSettings): Promise<void>
  /** Only the kinds the person changed. */
  listPrefs(userId: string): Promise<Map<OutboxEventType, NotificationPref>>
  /** null: back to the kind's defaults, the row is removed. */
  setPref(userId: string, kind: OutboxEventType, pref: NotificationPref | null): Promise<void>
  /** The anonymization (§10.4): the person's settings and every changed kind. */
  deleteAllForUser(userId: string): Promise<void>
}

/**
 * A person's Telegram chats with the bots (§12.3, plan 08 Scelta 8). Task 7 adds the link and the
 * commands; the anonymization needs only the removal.
 */
export interface TelegramLinksRepository {
  /** The system scope only: the person's links with every bot. Returns how many went. */
  deleteAllForUser(userId: string): Promise<number>
}
