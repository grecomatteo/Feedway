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
import { mediaUploadsCleanup } from './handlers/media-uploads-cleanup.js'
import { systemSelftest } from './handlers/system-selftest.js'
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
/** Every hour, at 17 past: expired uploads and the bytes of deleted files (plan 04 Task 9). */
export const MEDIA_UPLOADS_CLEANUP_CRON = '17 * * * *'
export const MEDIA_UPLOADS_CLEANUP_TZ = 'Europe/Rome'

export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
  const { queue, logger, queues } = deps
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
    'media.process': mediaProcess,
    'media.uploads_cleanup': mediaUploadsCleanup,
    ...deps.handlers,
  }
  const handlerDeps: JobHandlerDeps = { ...deps.services, logger, queue }

  const consume = async <N extends QueueName>(name: N, handler: JobHandler<N>) => {
    await queue.work(name, (job) => handler(job, handlerDeps))
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
  const stopHeartbeat = startHeartbeat(deps.heartbeatPath, deps.heartbeatEveryMs)

  return {
    async stop() {
      stopHeartbeat()
      // lets running jobs finish; whatever is still active afterwards is retried after expiry
      await queue.stop({ graceful: true, timeoutMs: STOP_TIMEOUT_MS })
    },
  }
}
