import type { Clock } from '../ports/clock.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { connectionJobKey } from './health.js'

// `accounts.daily` (§8.4, plan 03 Task 11): the system job of the accounts module. The system
// scope only lists the agencies; each agency's clean-up and queue run in its own scope, so a
// mistake here cannot touch another agency's rows.

export interface AccountsDailyDeps {
  uow: UnitOfWork
  clock: Clock
  queue: Pick<JobQueue, 'send'>
  logger: Logger
}

export interface AccountsDailyReport {
  organizations: number
  /** Syncs queued; each sync then queues the health check of its connection (Task 10). */
  queued: number
  attemptsDeleted: number
  pendingDeleted: number
  /** Agencies whose step failed: logged, and the job fails at the end to be retried. */
  failed: number
}

/** A new connection with no account imported after a day was abandoned (plan 03, choice 6). */
export const PENDING_CONNECTION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * For every active agency: deletes the expired login attempts and the abandoned `pending`
 * connections, then queues the sync of every `active` connection. Running it again the same
 * day queues nothing new: one sync per connection and day (UTC), and the queue keeps one
 * waiting per connection anyway.
 */
export async function runAccountsDaily(deps: AccountsDailyDeps): Promise<AccountsDailyReport> {
  const now = deps.clock.now()
  const day = now.toISOString().slice(0, 10)
  const organizations = (
    await deps.uow.runAsSystem('accounts.daily: active agencies', (tx) =>
      tx.organizations.listAll(),
    )
  ).filter((o) => o.status === 'active')
  const report: AccountsDailyReport = {
    organizations: organizations.length,
    queued: 0,
    attemptsDeleted: 0,
    pendingDeleted: 0,
    failed: 0,
  }
  for (const { id: organizationId } of organizations) {
    try {
      const active = await deps.uow.run({ organizationId, userId: null }, async (tx) => {
        report.attemptsDeleted += await tx.connectionAttempts.deleteExpired(organizationId, now)
        report.pendingDeleted += await tx.connections.deleteStalePending(
          organizationId,
          new Date(now.getTime() - PENDING_CONNECTION_MAX_AGE_MS),
        )
        return (await tx.connections.list(organizationId)).filter((c) => c.status === 'active')
      })
      for (const connection of active) {
        const job = { organizationId, connectionId: connection.id }
        const id = await deps.queue.send('accounts.sync', job, {
          singletonKey: connectionJobKey(job),
          dedupeKey: `daily:${day}:${connection.id}`,
        })
        if (id !== null) report.queued += 1
      }
    } catch (err) {
      report.failed += 1
      deps.logger.error({ organizationId, err }, 'accounts daily step failed')
    }
  }
  deps.logger.info({ report }, 'accounts daily done')
  if (report.failed > 0)
    throw new Error(`accounts daily failed for ${String(report.failed)} agencies`)
  return report
}
