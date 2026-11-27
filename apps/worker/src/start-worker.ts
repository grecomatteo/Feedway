import { recordWorkerBeat, wakeMediaProcessing } from '@app/application'
import type { JobQueue, JobScheduler, Logger, QueueName } from '@app/application'
import { accountsAvatar } from './handlers/accounts-avatar.js'
import { bulkImport } from './handlers/bulk-import.js'
import { accountsDaily } from './handlers/accounts-daily.js'
import { accountsHealth } from './handlers/accounts-health.js'
import { accountsSync } from './handlers/accounts-sync.js'
import {
  identityAccountLockedNotice,
  identityAccountLockedNoticeEmail,
} from './handlers/identity-account-locked-notice.js'
import { identityAccountRecoveryEmail } from './handlers/identity-account-recovery-email.js'
import { identityDataExport } from './handlers/identity-data-export.js'
import { identityEmailChange } from './handlers/identity-email-change.js'
import { identityAnonymizationNotice, identityRetention } from './handlers/identity-retention.js'
import { identityPasswordResetEmail } from './handlers/identity-password-reset-email.js'
import { identitySecurityEmail } from './handlers/identity-security-email.js'
import { mediaDeleteFiles } from './handlers/media-delete-files.js'
import { mediaProcess } from './handlers/media-process.js'
import { mediaPublishCopies } from './handlers/media-publish-copies.js'
import { mediaPublishCopiesCleanup } from './handlers/media-publish-copies-cleanup.js'
import { mediaUploadsCleanup } from './handlers/media-uploads-cleanup.js'
import {
  notifyDeliver,
  notifyDeliverPlatform,
  notifyDispatch,
  telegramPoll,
} from './handlers/notify.js'
import { postsCollaboratorsRefresh } from './handlers/posts-collaborators.js'
import { postsDraftsCleanup } from './handlers/posts-drafts-cleanup.js'
import { planDueScan } from './handlers/plan.js'
import { reportDaily, reportDigest } from './handlers/report.js'
import { systemSelftest } from './handlers/system-selftest.js'
import {
  schedulerReconcile,
  targetPrepare,
  targetPublish,
  targetReconcile,
  targetVerify,
} from './handlers/target-steps.js'
import type { JobHandler, JobHandlerDeps, JobHandlers } from './job-handler.js'
import { startDatabaseBeat, startHeartbeat } from './heartbeat.js'

export type { JobHandler, JobHandlerDeps, JobHandlers } from './job-handler.js'

export interface WorkerDeps {
  queue: JobQueue & JobScheduler
  logger: Logger
  /** Handed to every handler together with the logger. */
  services: Omit<JobHandlerDeps, 'logger' | 'queue'>
  heartbeatPath: string
  heartbeatEveryMs: number
  /**
   * The beat in the database (plan 08 P5): this instance's name (the container's host name),
   * the version, every 30 seconds. Tests of other things leave it out.
   */
  beat?: { instance: string; version: string; everyMs: number }
  /** Only these queues are consumed (WORKER_QUEUES, spec §6.4). */
  queues: readonly QueueName[]
  /** Overrides for tests; the real handlers are the default. */
  handlers?: Partial<JobHandlers>
}

const STOP_TIMEOUT_MS = 30_000
/** Every day at 03:30, Italian time (spec §15.7). */
export const RETENTION_CRON = '30 3 * * *'
export const RETENTION_TZ = 'Europe/Rome'
/** Every day at 04:00, Italian time: syncs and clean-up of the accounts (plan 03 Task 11). */
export const ACCOUNTS_DAILY_CRON = '0 4 * * *'
export const ACCOUNTS_DAILY_TZ = 'Europe/Rome'
/**
 * Every ten minutes, from 7 past: expired uploads, the bytes of deleted files (plan 04 Task 9)
 * and the files left `processing` by a worker stuck or gone (revisione tappa 4, P2).
 */
export const MEDIA_UPLOADS_CLEANUP_CRON = '7-59/10 * * * *'
export const MEDIA_UPLOADS_CLEANUP_TZ = 'Europe/Rome'
/** Every day at 04:30, Italian time: the copies to publish no post needs (plan 07 Scelta 5). */
export const PUBLISH_COPIES_CLEANUP_CRON = '30 4 * * *'
/** Every minute: each bot's `getUpdates`, about 50 s long (plan 08 Task 7). */
export const TELEGRAM_POLL_CRON = '* * * * *'
/** Every minute: the publishing's jobs that were never sent or were lost (plan 07 P3). */
export const SCHEDULER_RECONCILE_CRON = '* * * * *'
/** Every minute: each person has their own time and zone (plan 08 P7). */
export const REPORT_DAILY_CRON = '* * * * *'
/** Every minute is every minute in any zone: each digest is due in its person's zone. */
export const REPORT_DAILY_TZ = 'Europe/Rome'
/** Every 5 minutes: the plan's contents whose notice is due (plan 09 P3). */
export const PLAN_DUE_SCAN_CRON = '*/5 * * * *'
/** Every day at 03:45, Italian time: «Eliminati» and the drafts nobody touches (plan 09 Task 14). */
export const DRAFTS_CLEANUP_CRON = '45 3 * * *'

/**
 * Jobs of one queue at once in this worker. The preparations are limited per agency in the
 * database (plan 07 «Lavori pesanti»); the calls that publish are short and must not wait for
 * each other at 18:00 (CS1).
 */
export const QUEUE_CONCURRENCY: Partial<Record<QueueName, number>> = {
  'target.prepare': 3,
  'target.publish': 5,
}

export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
  const { queue, logger, queues } = deps
  // on stop, a conversion is interrupted at once: it gives its attempt back and is retried by
  // the next worker, instead of being killed by Docker halfway (revisione tappa 4, P2)
  const stopping = new AbortController()
  const mediaProcessOnStop: JobHandler<'media.process'> = (job, d) =>
    (deps.handlers?.['media.process'] ?? mediaProcess)(
      {
        ...job,
        signal: job.signal ? AbortSignal.any([job.signal, stopping.signal]) : stopping.signal,
      },
      d,
    )
  const mediaPublishCopiesOnStop: JobHandler<'media.publish_copies'> = (job, d) =>
    (deps.handlers?.['media.publish_copies'] ?? mediaPublishCopies)(
      {
        ...job,
        signal: job.signal ? AbortSignal.any([job.signal, stopping.signal]) : stopping.signal,
      },
      d,
    )
  // on stop, the long poll ends at once: the offset is on the bot's row, the next run goes on
  const telegramPollOnStop: JobHandler<'telegram.poll'> = (job, d) =>
    (deps.handlers?.['telegram.poll'] ?? telegramPoll)(
      {
        ...job,
        signal: job.signal ? AbortSignal.any([job.signal, stopping.signal]) : stopping.signal,
      },
      d,
    )
  const handlers: JobHandlers = {
    'system.selftest': systemSelftest,
    'identity.security_email': identitySecurityEmail,
    'identity.password_reset_email': identityPasswordResetEmail,
    'identity.account_locked_notice': identityAccountLockedNotice,
    'identity.account_locked_notice_email': identityAccountLockedNoticeEmail,
    'identity.account_recovery_email': identityAccountRecoveryEmail,
    'identity.email_change': identityEmailChange,
    'identity.data_export': identityDataExport,
    'identity.retention': identityRetention,
    'identity.anonymization_notice': identityAnonymizationNotice,
    'accounts.sync': accountsSync,
    'accounts.health': accountsHealth,
    'accounts.daily': accountsDaily,
    'accounts.avatar': accountsAvatar,
    'media.delete_files': mediaDeleteFiles,
    'media.uploads_cleanup': mediaUploadsCleanup,
    'media.publish_copies_cleanup': mediaPublishCopiesCleanup,
    'target.prepare': targetPrepare,
    'target.publish': targetPublish,
    'target.reconcile': targetReconcile,
    'target.verify': targetVerify,
    'scheduler.reconcile': schedulerReconcile,
    'notify.dispatch': notifyDispatch,
    'notify.deliver': notifyDeliver,
    'notify.deliver_platform': notifyDeliverPlatform,
    'report.daily': reportDaily,
    'report.digest': reportDigest,
    'plan.due_scan': planDueScan,
    'posts.drafts_cleanup': postsDraftsCleanup,
    'bulk.import': bulkImport,
    'posts.collaborators_refresh': postsCollaboratorsRefresh,
    ...deps.handlers,
    'telegram.poll': telegramPollOnStop,
    'media.process': mediaProcessOnStop,
    'media.publish_copies': mediaPublishCopiesOnStop,
  }
  const handlerDeps: JobHandlerDeps = { ...deps.services, logger, queue }

  const consume = async <N extends QueueName>(name: N, handler: JobHandler<N>) => {
    const concurrency = QUEUE_CONCURRENCY[name]
    await queue.work(
      name,
      (job) => handler(job, handlerDeps),
      concurrency === undefined ? undefined : { concurrency },
    )
    logger.info({ queue: name }, 'consuming queue')
  }
  // binds each name to its own handler type; a plain loop over the union does not type-check
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
  const consumeOne = <N extends QueueName>(name: N) => consume(name, handlers[name])
  for (const name of queues) await consumeOne(name)
  // the daily runs: pg-boss keeps one schedule per queue, so every worker setting it is harmless
  if (queues.includes('identity.retention'))
    await queue.schedule('identity.retention', RETENTION_CRON, {}, { tz: RETENTION_TZ })
  if (queues.includes('accounts.daily'))
    await queue.schedule('accounts.daily', ACCOUNTS_DAILY_CRON, {}, { tz: ACCOUNTS_DAILY_TZ })
  if (queues.includes('media.uploads_cleanup'))
    await queue.schedule(
      'media.uploads_cleanup',
      MEDIA_UPLOADS_CLEANUP_CRON,
      {},
      {
        tz: MEDIA_UPLOADS_CLEANUP_TZ,
      },
    )
  if (queues.includes('media.publish_copies_cleanup'))
    await queue.schedule(
      'media.publish_copies_cleanup',
      PUBLISH_COPIES_CLEANUP_CRON,
      {},
      { tz: MEDIA_UPLOADS_CLEANUP_TZ },
    )
  if (queues.includes('scheduler.reconcile'))
    await queue.schedule(
      'scheduler.reconcile',
      SCHEDULER_RECONCILE_CRON,
      {},
      { tz: MEDIA_UPLOADS_CLEANUP_TZ },
    )
  if (queues.includes('telegram.poll'))
    await queue.schedule('telegram.poll', TELEGRAM_POLL_CRON, {}, { tz: MEDIA_UPLOADS_CLEANUP_TZ })
  if (queues.includes('report.daily'))
    await queue.schedule('report.daily', REPORT_DAILY_CRON, {}, { tz: REPORT_DAILY_TZ })
  if (queues.includes('plan.due_scan'))
    await queue.schedule('plan.due_scan', PLAN_DUE_SCAN_CRON, {}, { tz: REPORT_DAILY_TZ })
  if (queues.includes('posts.drafts_cleanup'))
    await queue.schedule('posts.drafts_cleanup', DRAFTS_CLEANUP_CRON, {}, { tz: RETENTION_TZ })
  if (queues.includes('media.process') || queues.includes('media.publish_copies'))
    await wakeMediaProcessing({ uow: deps.services.uow, queue, logger })
  const stopHeartbeat = startHeartbeat(deps.heartbeatPath, deps.heartbeatEveryMs)
  const beat = deps.beat
  const stopDatabaseBeat = beat
    ? startDatabaseBeat(
        () =>
          recordWorkerBeat(deps.services, {
            instance: beat.instance,
            details: { version: beat.version, queues: queues.length },
          }),
        beat.everyMs,
        logger,
      )
    : () => undefined

  return {
    async stop() {
      stopping.abort()
      stopHeartbeat()
      stopDatabaseBeat()
      // lets running jobs finish; whatever is still active afterwards is retried after expiry
      await queue.stop({ graceful: true, timeoutMs: STOP_TIMEOUT_MS })
    },
  }
}
