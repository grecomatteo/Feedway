import type { JobQueue, JobScheduler, Logger, QueueName } from '@app/application'
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
  const stopHeartbeat = startHeartbeat(deps.heartbeatPath, deps.heartbeatEveryMs)

  return {
    async stop() {
      stopHeartbeat()
      // lets running jobs finish; whatever is still active afterwards is retried after expiry
      await queue.stop({ graceful: true, timeoutMs: STOP_TIMEOUT_MS })
    },
  }
}
