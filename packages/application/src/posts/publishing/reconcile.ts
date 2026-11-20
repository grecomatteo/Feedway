import { UNCERTAIN_FIRST_SEARCH_MINUTES, type TargetStatus } from '@app/domain'
import type { DueTarget } from '../../ports/publishing.js'
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

/** The states with a job of this stage; Task 8 adds the search and the verification. */
export const RECONCILED_STATUSES: readonly TargetStatus[] = [
  'scheduled',
  'preparing',
  'ready',
  'retrying',
  'publishing',
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
    default:
      return null
  }
}

export interface ReconcileReport {
  sent: number
  /** left `publishing` by a worker that stopped halfway: now `unknown` */
  uncertain: number
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
    await moveTarget(tx, target, 'unknown', {
      step: 'publish',
      nextAttemptAt: plusMinutes(now, UNCERTAIN_FIRST_SEARCH_MINUTES),
    })
    return true
  })
}

export async function reconcilePublishing(
  deps: Pick<PublishingWorkerDeps, 'uow' | 'clock' | 'queue' | 'logger'>,
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
      })
  }
  await sendSteps(deps, jobs)
  return { sent: jobs.length, uncertain }
}
