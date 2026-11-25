import {
  addDays,
  dueNotificationAt,
  instantToZoned,
  isModuleEnabled,
  isPreparedBy,
  referenceInstant,
  storedTimeZone,
} from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import type { ExclusiveLock } from '../ports/media-processing.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { getStatuses } from '../posts/index.js'

// `plan.due_scan` (plan 09 P3, Task 8): every 5 minutes, «Contenuto da preparare entro domani»
// for every content not prepared whose notification time has come and whose reference instant
// has not. No job per content: the scan reads the state of now, so a content created or moved
// after its time is told at the next run, and so is one whose time came while the worker was
// stopped. The key `plan:<content>:<reference instant>` writes it once; a content moved to
// another day has a new key and is told again. The system scope only lists the agencies; each one
// is read and written in its own scope.

export interface PlanDueScanDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  /** The installation's lock (ADR 021): with more workers, one run at a time */
  lock: ExclusiveLock
}

export interface PlanDueScanReport {
  /** false: another worker holds the run */
  ran: boolean
  organizations: number
  /** events written now: the others were written by an earlier run */
  told: number
  /** agencies whose step failed: logged, and the job fails at the end to be retried */
  failed: number
}

export const PLAN_DUE_SCAN_LOCK = 'plan.due_scan'

/** The key of one content's notice: a content moved has a new reference and a new key. */
export const planDueKey = (itemId: string, reference: Date) =>
  `plan:${itemId}:${reference.toISOString()}`

/** One agency: the contents of today and the next two days, the only ones whose time can come. */
async function scanAgency(tx: Tx, organizationId: string, timeZone: string, now: Date) {
  // a content's notice comes at most a day and a half before its day ends (9:00 the day before)
  const today = instantToZoned(now, timeZone).localDate
  const items = await tx.plan.listOfAgencyInRange(organizationId, {
    from: today,
    to: addDays(today, 2),
  })
  if (items.length === 0) return 0
  const statuses = await getStatuses(
    tx,
    organizationId,
    items.flatMap((i) => (i.postId ? [i.postId] : [])),
  )
  const archived = new Map<string, boolean>()
  const isArchived = async (workspaceId: string) => {
    let known = archived.get(workspaceId)
    if (known === undefined) {
      const workspace = await tx.workspaces.findById(organizationId, workspaceId)
      known = !workspace || workspace.archivedAt !== null
      archived.set(workspaceId, known)
    }
    return known
  }
  let told = 0
  for (const item of items) {
    const status = item.postId ? statuses.get(item.postId) : undefined
    if (isPreparedBy(status === undefined ? null : { status, scheduledAt: null })) continue
    const reference = referenceInstant(item.localDate, item.localTime, timeZone)
    if (now >= reference || dueNotificationAt(item, timeZone) > now) continue
    // an archived client's plan is not written any more: nobody is asked to prepare it
    if (await isArchived(item.workspaceId)) continue
    const written = await tx.outbox.record({
      organizationId,
      type: 'plan.due_soon',
      payload: {
        workspaceId: item.workspaceId,
        planItemId: item.id,
        dueAt: reference.toISOString(),
      },
      dedupeKey: planDueKey(item.id, reference),
    })
    if (written) told += 1
  }
  return told
}

export async function scanPlanDue(deps: PlanDueScanDeps): Promise<PlanDueScanReport> {
  const run = await deps.lock.tryRun(PLAN_DUE_SCAN_LOCK, async () => {
    const now = deps.clock.now()
    const organizations = (
      await deps.uow.runAsSystem('plan.due_scan: agencies', (tx) => tx.organizations.listAll(), {
        routine: true,
      })
    ).filter((o) => o.status === 'active' && isModuleEnabled(o.settings, 'plan'))
    let told = 0
    let failed = 0
    for (const organization of organizations) {
      try {
        told += await deps.uow.run({ organizationId: organization.id, userId: null }, (tx) =>
          scanAgency(tx, organization.id, storedTimeZone(organization.settings), now),
        )
      } catch (err) {
        failed += 1
        deps.logger.error({ organizationId: organization.id, err }, 'plan due scan step failed')
      }
    }
    return { organizations: organizations.length, told, failed }
  })
  if (!run.acquired) return { ran: false, organizations: 0, told: 0, failed: 0 }
  if (run.value.failed > 0)
    throw new Error(`plan due scan failed for ${String(run.value.failed)} agencies`)
  return { ran: true, ...run.value }
}
