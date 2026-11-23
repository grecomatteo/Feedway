import { wakeMediaProcessing } from '@app/application'
import type { JobQueue, JobScheduler, Logger, QueueName } from '@app/application'
import { accountsAvatar } from './handlers/accounts-avatar.js'
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
import { notifyDeliver, notifyDeliverPlatform, notifyDispatch } from './handlers/notify.js'
import { systemSelftest } from './handlers/system-selftest.js'
import {
  schedulerReconcile,
  targetPrepare,
  targetPublish,
  targetReconcile,
  targetVerify,
} from './handlers/target-steps.js'
import type { JobHandler, JobHandlerDeps, JobHandlers } from './job-handler.js'
import { startHeartbeat } from './heartbeat.js'

export type { JobHandler, JobHandlerDeps, JobHandlers } from './job-handler.js'

export interface WorkerDeps {
  queue: JobQueue & JobScheduler
  logger: Logger
  /** Handed to every handler together with the logger. */
  services: Omit<JobHandlerDeps, 'logger' | 'queue'>
  heartbeatPath: string
  heartbeatEveryMs: number
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
/** Every minute: the publishing's jobs that were never sent or were lost (plan 07 P3). */
export const SCHEDULER_RECONCILE_CRON = '* * * * *'

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
    ...deps.handlers,
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
  if (queues.includes('media.process') || queues.includes('media.publish_copies'))
    await wakeMediaProcessing({ uow: deps.services.uow, queue, logger })
  const stopHeartbeat = startHeartbeat(deps.heartbeatPath, deps.heartbeatEveryMs)

  return {
    async stop() {
      stopping.abort()
      stopHeartbeat()
      // lets running jobs finish; whatever is still active afterwards is retried after expiry
      await queue.stop({ graceful: true, timeoutMs: STOP_TIMEOUT_MS })
    },
  }
}
