import type { QueueName, QueueScopes } from '@app/application'
import { MEDIA_PROCESS_EXPIRE_SECONDS } from '@app/domain'

export interface QueueDefinition<N extends QueueName = QueueName> {
  name: N
  /** pg-boss queue policy: decides what the queue allows to be pending or active at once. */
  policy: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive'
  /** Must match the scope in JobPayloads: the type below rejects a mismatch. */
  scope: QueueScopes[N]
  /**
   * How long pg-boss keeps a job, in seconds: waiting (`retentionSeconds`) and after it ends
   * (`deleteAfterSeconds`). Unset: the pg-boss defaults (14 and 7 days).
   */
  retention?: { retentionSeconds: number; deleteAfterSeconds: number }
  /**
   * How long a job may stay active before pg-boss aborts its signal and retries it. Unset: the
   * pg-boss default, 15 minutes (ADR 021).
   */
  expireInSeconds?: number
}

const REGISTRY: { [N in QueueName]: Omit<QueueDefinition<N>, 'name'> } = {
  'system.selftest': { policy: 'short', scope: 'system' },
  'identity.security_email': { policy: 'standard', scope: 'user' },
  // the data holds a reset link: gone after an hour, when the link has expired anyway
  'identity.password_reset_email': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 3600, deleteAfterSeconds: 3600 },
  },
  // ids only; a notice still waiting after three days is no longer news
  'identity.account_locked_notice': {
    policy: 'standard',
    scope: 'system',
    retention: { retentionSeconds: 3 * 86_400, deleteAfterSeconds: 86_400 },
  },
  'identity.account_locked_notice_email': {
    policy: 'standard',
    scope: 'system',
    retention: { retentionSeconds: 3 * 86_400, deleteAfterSeconds: 86_400 },
  },
  // the data holds the recovery link: gone after its 30 minutes
  'identity.account_recovery_email': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 1800, deleteAfterSeconds: 1800 },
  },
  // the data holds the confirmation link to the new address: gone after its hour
  'identity.email_change': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 3600, deleteAfterSeconds: 3600 },
  },
  // ids only; an archive asked a day ago and never built is no longer wanted
  'identity.data_export': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
  },
  // one run at a time; a run that waited a day is replaced by the next one
  'identity.retention': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  // ids and a date; the Owner can be told again by the next day's run
  'identity.anonymization_notice': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 3 * 86_400, deleteAfterSeconds: 86_400 },
  },
  // ids only; per connection (singletonKey) one running and one waiting, a further one is
  // refused; a job that waited a day is dropped
  'accounts.sync': {
    policy: 'stately',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  'accounts.health': {
    policy: 'stately',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  // as the retention: one run at a time, a run that waited a day is replaced by the next one
  'accounts.daily': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  // ids only; per account (singletonKey) one running and one waiting; the next sync queues it
  // again, so a job that waited a day is dropped
  'accounts.avatar': {
    policy: 'stately',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  // ids only; repeatable, so a job that runs twice for one file is harmless; one that waited a
  // week is no longer kept
  'media.delete_files': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 7 * 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  // ids only, a wake-up (ADR 021): the files waiting are in the media table, so a job lost or
  // dropped after a week loses no file; it may run two long ffmpeg commands
  'media.process': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 7 * 86_400, deleteAfterSeconds: 7 * 86_400 },
    expireInSeconds: MEDIA_PROCESS_EXPIRE_SECONDS,
  },
  // ids only, a wake-up as `media.process` (plan 07 Task 6): the copies waiting are rows of
  // media_variants; one copy may be a long ffmpeg command
  'media.publish_copies': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 7 * 86_400, deleteAfterSeconds: 7 * 86_400 },
    expireInSeconds: MEDIA_PROCESS_EXPIRE_SECONDS,
  },
  // every hour, one run at a time; a run that waited a day is replaced by the next ones
  'media.uploads_cleanup': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
}

export const QUEUES: readonly QueueDefinition[] = (Object.keys(REGISTRY) as QueueName[]).map(
  (name) => ({ name, ...REGISTRY[name] }),
)

export const QUEUE_NAMES: readonly QueueName[] = QUEUES.map((q) => q.name)

/** Applied to every queue; a failed job is retried with exponential backoff. */
export const QUEUE_DEFAULTS = { retryLimit: 3, retryBackoff: true, retryDelay: 5 } as const
