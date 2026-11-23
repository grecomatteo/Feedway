import type {
  Channel,
  DigestSchedule,
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

/** A delivery the dispatcher sends a job for (P1, P2). */
export interface DeliveryRef {
  id: string
  organizationId: string | null
  userId: string
  channel: Channel
  status: NewDeliveryStatus | 'sending' | 'sent' | 'failed'
  attempts: number
  nextAttemptAt: Date | null
}

/** One delivery of a claimed group, with its notification's event (P3: ids and codes only). */
export interface ClaimedDelivery {
  id: string
  notificationId: string
  kind: OutboxEventType
  channel: Channel
  attempts: number
  eventId: string
  workspaceId: string | null
  payload: OutboxPayload
  createdAt: Date
}

/** How a claimed group ended (plan 08, «Ogni invio in transazione corta»). */
export type DeliveryOutcome =
  | { status: 'sent' }
  /** a failure with tries left: `attempts` goes up by one */
  | { status: 'pending'; nextAttemptAt: Date; error: string }
  | { status: 'failed' | 'skipped'; error: string }

export interface NotificationsRepository {
  /**
   * Writes the notification and its deliveries. null: the person already has this event's
   * (a dispatch run again), nothing written.
   */
  create(notification: NewNotification): Promise<DeliveryRef[] | null>
  /**
   * The system scope only (P2): `pending` deliveries whose time has come, oldest first. The
   * dispatcher sends their job again, under the same key while it is the same attempt.
   * `platform`: only the platform's, which the web sends while the worker is down (Scelta 10).
   */
  listDue(now: Date, limit: number, only?: 'all' | 'platform'): Promise<DeliveryRef[]>
  /**
   * The system scope only (P2): groups left `sending` by a process that fell before saving go
   * back to `pending`, with one more attempt and due now, and are returned; those that used up
   * `maxAttempts` this way become `failed` with `gaveUp`, so a group that makes its process fall
   * is not sent again forever.
   */
  releaseExpiredClaims(
    now: Date,
    limit: { maxAttempts: number; gaveUp: string },
  ): Promise<DeliveryRef[]>
  /**
   * Claims the group of `deliveryId` (P1), with `FOR UPDATE SKIP LOCKED`: if it is `pending` and
   * due, it and the other `pending` ones of the same person, agency, channel and kind not
   * waiting for a retry become `sending` until `claimedUntil`. Empty: nothing to send (another
   * job of the group took it, or it is not due).
   */
  claimGroup(input: {
    deliveryId: string
    userId: string
    /** the job's agency, null for the platform's: a delivery of another is never claimed */
    organizationId: string | null
    now: Date
    claimedUntil: Date
  }): Promise<ClaimedDelivery[]>
  /** Saves how the claim ended; only rows still under this claim. Returns how many. */
  finishClaim(ids: readonly string[], claimedUntil: Date, outcome: DeliveryOutcome): Promise<number>
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
  /**
   * The system scope only (`report.daily`, P7): the digest of those of these people who changed
   * theirs; the others have `DEFAULT_DIGEST`.
   */
  listDigestSchedules(userIds: readonly string[]): Promise<Map<string, DigestSchedule>>
}

/**
 * A person's Telegram chats with the bots (§12.3, plan 08 Scelta 8). Task 7 adds the link and the
 * commands; the anonymization needs only the removal.
 */
export interface TelegramLinksRepository {
  /** The system scope only: the person's links with every bot. Returns how many went. */
  deleteAllForUser(userId: string): Promise<number>
}
