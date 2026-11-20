import {
  PUBLISHING_STALE_MINUTES,
  UNCERTAIN_FIRST_SEARCH_MINUTES,
  type TargetStatus,
} from '@app/domain'
import type { DueTarget } from '../../ports/publishing.js'
import { recheckTarget } from './recheck.js'
import { uncertainSearch } from './search.js'
import {
  moveTarget,
  plusMinutes,
  sendSteps,
  type PublishingWorkerDeps,
  type StepJob,
} from './context.js'

// `scheduler.reconcile` (plan 07 Task 7, P3): every minute, the destinations whose time has
// come get their step's job again. The panel and the steps send their jobs after the commit;
// what a stopped process never sent, or a job pg-boss dropped, is sent here within a minute,
// with the same key, so a job still waiting is not doubled. The one read across the agencies
// is here (listed in the ESLint rule on `runAsSystem`); every write is in the agency's scope.

/** At most this many destinations a minute: the next run takes the rest. */
export const RECONCILE_BATCH = 500

/**
 * A destination still due this long after its time had its job used up (failed, and kept a
 * day under its key): it gets a job under a new key. Longer than a job's run and its retries.
 */
export const RESEND_EVERY_MINUTES = 10

const resendOf = (due: DueTarget, now: Date) =>
  Math.max(
    0,
    Math.floor((now.getTime() - due.nextAttemptAt.getTime()) / (RESEND_EVERY_MINUTES * 60_000)),
  )

/** The states with a job of the worker: every one but those a person decides. */
export const RECONCILED_STATUSES: readonly TargetStatus[] = [
  'scheduled',
  'preparing',
  'ready',
  'retrying',
  'publishing',
  'unknown',
  'published',
  'verifying',
]

export function stepOf(due: Pick<DueTarget, 'status' | 'step'>): StepJob['name'] | null {
  switch (due.status) {
    case 'scheduled':
    case 'preparing':
      return 'target.prepare'
    case 'ready':
      return 'target.publish'
    case 'retrying':
      return due.step === 'publish' ? 'target.publish' : 'target.prepare'
    case 'unknown':
      return 'target.reconcile'
    case 'published':
    case 'verifying':
      return 'target.verify'
    default:
      return null
  }
}

export interface ReconcileReport {
  sent: number
  /** left `publishing` by a worker that stopped halfway: now `unknown` */
  uncertain: number
  /** destinations checked again 3 hours before (Scelta 4) */
  rechecked: number
  /** of those, the ones that will not go out as they are: `post.file_wont_publish` */
  told: number
}

/** A call to publish that never came back: the post may be out, so it is searched (§9.5). */
async function takeAsUncertain(
  deps: Pick<PublishingWorkerDeps, 'uow'>,
  due: DueTarget,
  now: Date,
): Promise<boolean> {
  return deps.uow.run({ organizationId: due.organizationId, userId: null }, async (tx) => {
    const target = await tx.publishing.lockTarget(due.organizationId, due.targetId)
    if (target?.status !== 'publishing' || target.generation !== due.generation) return false
    // the call started when `publishing` was written, `PUBLISHING_STALE_MINUTES` before its
    // `next_attempt_at`; the first search is sent by the next run, at its time
    const startedAt = plusMinutes(due.nextAttemptAt, -PUBLISHING_STALE_MINUTES)
    await moveTarget(tx, target, 'unknown', {
      step: 'publish',
      attempts: 0,
      nextAttemptAt: plusMinutes(now, UNCERTAIN_FIRST_SEARCH_MINUTES),
      verification: uncertainSearch(startedAt, now),
    })
    return true
  })
}

export async function reconcilePublishing(
  deps: Pick<
    PublishingWorkerDeps,
    'uow' | 'clock' | 'queue' | 'logger' | 'platformRules' | 'publishingHistory'
  >,
): Promise<ReconcileReport> {
  const now = deps.clock.now()
  const due = await deps.uow.runAsSystem('scheduler.reconcile: destinations due', (tx) =>
    tx.publishing.dueTargets(now, RECONCILE_BATCH, RECONCILED_STATUSES),
  )
  const jobs: StepJob[] = []
  let uncertain = 0
  for (const d of due) {
    if (d.status === 'publishing') {
      if (await takeAsUncertain(deps, d, now)) uncertain += 1
      continue
    }
    const name = stepOf(d)
    if (name)
      jobs.push({
        name,
        organizationId: d.organizationId,
        targetId: d.targetId,
        generation: d.generation,
        resend: resendOf(d, now),
      })
  }
  await sendSteps(deps, jobs)
  const { rechecked, told } = await recheckDue(deps, now)
  return { sent: jobs.length, uncertain, rechecked, told }
}

/** The checks 3 hours before whose time has come, each in its agency's scope (Scelta 4). */
async function recheckDue(
  deps: Parameters<typeof recheckTarget>[0],
  now: Date,
): Promise<{ rechecked: number; told: number }> {
  const due = await deps.uow.runAsSystem('scheduler.reconcile: checks before publishing', (tx) =>
    tx.publishing.dueRechecks(now, RECONCILE_BATCH),
  )
  let rechecked = 0
  let told = 0
  for (const d of due) {
    try {
      const outcome = await recheckTarget(deps, d)
      if (outcome !== 'skipped') rechecked += 1
      if (outcome === 'told') told += 1
    } catch (error) {
      // one destination's failure does not stop the others; it is tried again next minute
      deps.logger.error({ err: error, targetId: d.targetId }, 'check before publishing failed')
    }
  }
  return { rechecked, told }
}
