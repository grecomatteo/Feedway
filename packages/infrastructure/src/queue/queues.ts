import type { QueueName, QueueScopes } from '@app/application'
import { MEDIA_PROCESS_EXPIRE_SECONDS, TARGET_STEP_EXPIRE_SECONDS } from '@app/domain'

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
  // every night, one run at a time (plan 07 Scelta 5): the copies are rows of media_variants, so
  // a night missed is done by the next one
  'media.publish_copies_cleanup': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 7 * 86_400 },
  },
  // ids and a generation (plan 07 P3): the state is in post_targets, and the reconciler sends a
  // job lost or dropped again within a minute; a finished one is kept a day, so a key sent
  // twice is one job
  'target.prepare': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
    expireInSeconds: TARGET_STEP_EXPIRE_SECONDS,
  },
  'target.publish': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
    expireInSeconds: TARGET_STEP_EXPIRE_SECONDS,
  },
  'target.reconcile': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
    expireInSeconds: TARGET_STEP_EXPIRE_SECONDS,
  },
  'target.verify': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
    expireInSeconds: TARGET_STEP_EXPIRE_SECONDS,
  },
  // every minute, one run at a time; a run that waited is replaced by the next one
  'scheduler.reconcile': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 300, deleteAfterSeconds: 3600 },
  },
  // after every commit that wrote an event, and every minute (plan 08 P2): one queued and one
  // running; the state is in the outbox and the deliveries, so a run lost is the next one's
  'notify.dispatch': {
    policy: 'stately',
    scope: 'system',
    retention: { retentionSeconds: 300, deleteAfterSeconds: 3600 },
  },
  // ids only (P1): the state is in notification_deliveries and the dispatcher sends a job lost or
  // dropped again within a minute; a finished one is kept a day, so a key sent twice is one job
  'notify.deliver': {
    policy: 'standard',
    scope: 'organization',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
  },
  'notify.deliver_platform': {
    policy: 'standard',
    scope: 'system',
    retention: { retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
  },
  // every minute, one run at a time (plan 08 Task 7): its lock keeps a second worker off,
  // and each bot's offset is on its row, so a run lost is the next one's
  'telegram.poll': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 300, deleteAfterSeconds: 3600 },
    expireInSeconds: 120,
  },
  // every minute, one run at a time (plan 08 P7); a run that waited is replaced by the next one
  'report.daily': {
    policy: 'singleton',
    scope: 'system',
    retention: { retentionSeconds: 300, deleteAfterSeconds: 3600 },
  },
  // ids and a date; a finished one is kept two days, longer than the catch-up window, so the key
  // `<userId>:<date>` sent every minute of that window is one job
  'report.digest': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 3 * 3600, deleteAfterSeconds: 2 * 86_400 },
  },
}

export const QUEUES: readonly QueueDefinition[] = (Object.keys(REGISTRY) as QueueName[]).map(
  (name) => ({ name, ...REGISTRY[name] }),
)

export const QUEUE_NAMES: readonly QueueName[] = QUEUES.map((q) => q.name)

/** Applied to every queue; a failed job is retried with exponential backoff. */
export const QUEUE_DEFAULTS = { retryLimit: 3, retryBackoff: true, retryDelay: 5 } as const
