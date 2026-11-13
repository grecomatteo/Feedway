/**
 * Who a job belongs to (plan §4): an `organization` job carries `organizationId` and its handler
 * opens `uow.run` in that agency; a `user` job carries `userId` and opens `uow.run({ userId })`;
 * only `system` jobs may use `runAsSystem`.
 */
export type QueueScope = 'organization' | 'user' | 'system'

type ScopeFields = {
  organization: { organizationId: string }
  user: { userId: string }
  system: object
}

/** The data of a job in a queue of scope `S`: the scope's ids are required by the type. */
export type ScopedPayload<S extends QueueScope, D extends object> = D & ScopeFields[S]

/** Every queue: its scope and its own data. Adding a queue starts here. */
interface JobDefinitions {
  'system.selftest': { scope: 'system'; data: { requestedAt: string } }
  'identity.security_email': { scope: 'user'; data: SecurityEmailData }
  'identity.password_reset_email': { scope: 'user'; data: PasswordResetEmailData }
  'identity.account_locked_notice': { scope: 'system'; data: AccountLockedNoticeData }
  'identity.account_locked_notice_email': { scope: 'system'; data: AccountLockedNoticeEmailData }
  'identity.account_recovery_email': { scope: 'user'; data: AccountRecoveryEmailData }
  'identity.email_change': { scope: 'user'; data: EmailChangeEmailData }
  'identity.data_export': { scope: 'user'; data: DataExportJobData }
  'identity.retention': { scope: 'system'; data: object }
  'identity.anonymization_notice': { scope: 'user'; data: AnonymizationNoticeData }
  'accounts.sync': { scope: 'organization'; data: ConnectionJobData }
  'accounts.health': { scope: 'organization'; data: ConnectionJobData }
  'accounts.daily': { scope: 'system'; data: object }
  'accounts.avatar': { scope: 'organization'; data: AccountAvatarJobData }
}

/** The picture of one social account (plan 04 Task 4): its id only. */
export interface AccountAvatarJobData {
  accountId: string
}

/** A job about one connection of the agency (§8.4): its id only, never its token. */
export interface ConnectionJobData {
  connectionId: string
}

/**
 * To an Owner (`userId`): a person disabled by the platform will be anonymized on
 * `scheduledFor` (ISO 8601) unless reactivated. Ids and a date only.
 */
export interface AnonymizationNoticeData {
  subjectId: string
  organizationId: string
  scheduledFor: string
}

/** "Scarica i miei dati": the request's IP goes to the activity entry written when it is ready. */
export interface DataExportJobData {
  exportId: string
  ip: string | null
}

/**
 * "Non sono stato io": tells the platform administrators and the Owners of the person's agencies.
 * A system job (it reads every agency the person works for); ids and the time only.
 */
export interface AccountLockedNoticeData {
  lockedUserId: string
  /** ISO 8601: the lock it is about; a later reactivation makes the notice pointless. */
  lockedAt: string
}

/** One recipient of a lock notice: one job each, so a failed email is retried alone. */
export interface AccountLockedNoticeEmailData extends AccountLockedNoticeData {
  recipientId: string
}

/**
 * After a verified reactivation: the one-use link to choose a new password. It holds the token,
 * so the job is kept only as long as the link works (30 minutes).
 */
export interface AccountRecoveryEmailData {
  url: string
  /** ISO 8601 */
  expiresAt: string
  /**
   * `reactivated` (also when absent): after a "Non sono stato io" lock (enable-user);
   * `recovered`: the person had no way in left (recover-user).
   */
  reason?: 'reactivated' | 'recovered'
}

/** "Password dimenticata": the link holds the reset token, so the job is kept one hour only. */
export interface PasswordResetEmailData {
  url: string
  /**
   * ISO 8601: when the link was made and when it stops working, for the email's wording. Missing
   * in jobs queued before they were added: the handler then assumes an hour from now.
   */
  requestedAt?: string
  expiresAt?: string
}

/** The kinds of security email; the texts are `email.security.<kind>.*` in it.json. */
export const SECURITY_EMAIL_KINDS = [
  'new_device',
  'password_changed',
  'password_reset',
  'email_change_requested',
  'email_changed',
  'totp_enabled',
  'totp_disabled',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
] as const

export type SecurityEmailKind = (typeof SECURITY_EMAIL_KINDS)[number]

export interface SecurityEmailData {
  kind: SecurityEmailKind
  /** ISO 8601 */
  occurredAt: string
  /** Readable browser and system, e.g. "Safari su iOS"; never the device id. */
  deviceLabel: string
  /** Already shortened (last IPv4 octet zero, IPv6 /48). */
  ip: string | null
  /**
   * Where to write instead of the account's address: for `email_change_requested` (E5b, sent
   * when the change is asked) and `email_changed` (once it is done, Task 25) the address the
   * account had then, so the notice reaches it even after the new one is confirmed.
   */
  notifyEmail?: string
  /** `email_change_requested`: the address asked for, shown in full (the person chose it). */
  newEmail?: string
}

/** E5: the confirmation link to the new address. It holds the token: kept one hour only. */
export interface EmailChangeEmailData {
  to: string
  url: string
  /** ISO 8601: when the link stops working, for the email's wording. */
  expiresAt: string
}

export type QueueName = keyof JobDefinitions

export type JobPayloads = {
  [N in QueueName]: ScopedPayload<JobDefinitions[N]['scope'], JobDefinitions[N]['data']>
}

export type QueueScopes = { [N in QueueName]: JobDefinitions[N]['scope'] }

export interface JobQueue {
  send<N extends QueueName>(
    name: N,
    data: JobPayloads[N],
    opts?: {
      singletonKey?: string
      startAfter?: Date
      /**
       * At most one job per key while pg-boss keeps it (completed ones included): a retried
       * producer does not queue the same work twice. null: the job already existed.
       */
      dedupeKey?: string
    },
  ): Promise<string | null>
  work<N extends QueueName>(
    name: N,
    handler: (job: { id: string; data: JobPayloads[N] }) => Promise<void>,
    opts?: { concurrency?: number },
  ): Promise<void>
  ping(): Promise<void>
  stop(opts: { graceful: boolean; timeoutMs: number }): Promise<void>
}

/** The consumer's cron schedules (pg-boss `schedule`), apart from `JobQueue`: the web never schedules. */
export interface JobScheduler {
  /** Runs `name` on a cron schedule (five fields) in time zone `tz`; again replaces it. */
  schedule<N extends QueueName>(
    name: N,
    cron: string,
    data: JobPayloads[N],
    opts: { tz: string },
  ): Promise<void>
}
