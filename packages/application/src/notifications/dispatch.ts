import { DELIVERY_ATTEMPTS, channelsFor, groupWindow, type Channel } from '@app/domain'
import { usableTimeZone } from '../mail/index.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { NewDeliveryStatus, DeliveryRef, NewNotification } from '../ports/notifications.js'
import type { PendingOutboxEvent } from '../ports/publishing.js'
import type { Tx } from '../ports/tx.js'
import { StoreUnavailableError } from '../ports/unit-of-work.js'
import { isUuid } from '../identity/index.js'
import { deliverGroup, recipientOf, type DeliverDeps, type DeliverReport } from './deliver.js'
import { candidatesOf, eligibleUser, placeOfEvent } from './recipients.js'

// `notify.dispatch` (plan 08 P2): a system job, one queued and one running, that empties the
// outbox in batches. For each event it finds who gets it and where (Task 3), writes the
// notifications and their deliveries and marks the event, in one transaction; after the commit
// it sends a `notify.deliver` per delivery, due when its group is (Scelta 7). The same run sends
// again the jobs of the deliveries whose time has come and of the claims a fallen process left.
// The reads across the agencies are here (listed in the ESLint rule on `runAsSystem`); every
// delivery runs in its recipient's scope.

/** Events read at a time; a run goes on while batches come back full, up to `MAX_BATCHES`. */
export const DISPATCH_BATCH = 100
const MAX_BATCHES = 10
/** Deliveries sent again per run: the next run takes the rest. */
export const SWEEP_BATCH = 500
/**
 * A delivery still due this long after its time had its job used up (pg-boss keeps a finished
 * one a day under its key): it gets a job under a new key, as the publishing's (plan 07 P3).
 */
export const RESEND_EVERY_MINUTES = 10

export interface DispatchDeps extends DeliverDeps {
  queue: Pick<JobQueue, 'send'>
}

export interface DispatchReport {
  events: number
  notifications: number
  /** jobs sent for new deliveries and for those due again */
  jobs: number
}

export interface Built {
  notification: NewNotification
}

const OUTSIDE: ReadonlySet<Channel> = new Set(['telegram', 'email'])

/** The dispatcher runs every minute and after every event: its transactions log at debug. */
const ROUTINE = { routine: true } as const

/**
 * The notifications of one event, one per person who still sees it and did not turn it off.
 * Their deliveries outside the panel are due at `due`: when the group closes (Scelta 7), or now
 * for the worker's alarm that the web sends itself (Scelta 10).
 */
export async function notificationsOf(
  deps: Omit<DispatchDeps, 'queue'>,
  tx: Tx,
  event: PendingOutboxEvent,
  now: Date,
  due: Date = groupWindow(now),
): Promise<Built[]> {
  const kind = deps.kinds.get(event.type)
  if (!kind) {
    // every type has a kind (a test holds it): a missing one is a bug, the event is not retried
    deps.logger.error({ eventId: event.id, type: event.type }, 'outbox event without a kind')
    return []
  }
  const place = placeOfEvent(event)
  const organization =
    place.organizationId === null ? null : await tx.organizations.findById(place.organizationId)
  if (place.organizationId !== null && !organization) return []
  const suspended = organization !== null && organization.status !== 'active'
  const built: Built[] = []
  for (const candidate of await candidatesOf(tx, event, kind.recipients, now)) {
    // an anonymized or disabled person, or one who lost the client meanwhile, gets nothing
    const user = await eligibleUser(tx, candidate.userId, place, kind.recipients)
    if (!user) continue
    const settings = await tx.notificationPrefs.getSettings(user.id)
    const pref = (await tx.notificationPrefs.listPrefs(user.id)).get(event.type) ?? null
    const channels = channelsFor({
      kind,
      recipient: candidate,
      pref,
      settings,
      now,
      timeZone: usableTimeZone(user.timezone, deps.defaultTimezone),
    })
    if (channels.length === 0) continue
    const recipient = recipientOf(user, place.organizationId)
    const deliveries: NewNotification['deliveries'][number][] = []
    for (const channel of channels) {
      const skipped = (error: string) => ({
        channel,
        status: 'skipped' as NewDeliveryStatus,
        nextAttemptAt: null,
        error,
      })
      if (channel === 'panel') {
        deliveries.push({ channel, status: 'sent', nextAttemptAt: null, error: null })
        continue
      }
      // a suspended agency: the centre keeps the rows, nothing goes out (plan 08 «Agenzia sospesa»)
      if (suspended && OUTSIDE.has(channel)) {
        deliveries.push(skipped(deps.t('notify.skipped.suspended')))
        continue
      }
      const sender = deps.channels.find((c) => c.name === channel)
      if (!sender) deliveries.push(skipped(deps.t(`notify.skipped.${channel}`)))
      else if (!(await sender.isAvailable(tx, recipient)))
        deliveries.push(skipped(sender.unavailable))
      else
        deliveries.push({
          channel,
          status: 'pending',
          nextAttemptAt: due,
          error: null,
        })
    }
    built.push({
      notification: {
        organizationId: place.organizationId,
        userId: user.id,
        eventId: event.id,
        kind: event.type,
        level: kind.level,
        workspaceId: place.workspaceId,
        payload: event.payload,
        deliveries,
      },
    })
  }
  return built
}

/** The job of one delivery, keyed by its attempt (P1) and, when it stays due, by the resend. */
async function sendJob(deps: DispatchDeps, ref: DeliveryRef, now: Date): Promise<boolean> {
  const due = ref.nextAttemptAt ?? now
  const resend = Math.max(
    0,
    Math.floor((now.getTime() - due.getTime()) / (RESEND_EVERY_MINUTES * 60_000)),
  )
  const opts = {
    dedupeKey: `${ref.id}:${String(ref.attempts)}:${String(resend)}`,
    ...(due.getTime() > now.getTime() && { startAfter: due }),
  }
  try {
    const id =
      ref.organizationId === null
        ? await deps.queue.send(
            'notify.deliver_platform',
            { deliveryId: ref.id, recipientUserId: ref.userId },
            opts,
          )
        : await deps.queue.send(
            'notify.deliver',
            {
              organizationId: ref.organizationId,
              deliveryId: ref.id,
              recipientUserId: ref.userId,
            },
            opts,
          )
    return id !== null
  } catch (error) {
    // the rows are saved: the next run sends it again
    deps.logger.error({ err: error, deliveryId: ref.id }, 'notification job not sent')
    return false
  }
}

/** One batch of the outbox in one transaction; the jobs of its deliveries after the commit. */
async function dispatchBatch(
  deps: DispatchDeps,
  report: DispatchReport,
  limit: number,
): Promise<number> {
  const now = deps.clock.now()
  const { events, written, pending } = await deps.uow.runAsSystem(
    'notify.dispatch: the outbox',
    async (tx) => {
      const taken = await tx.outbox.takePending(limit)
      const refs: DeliveryRef[] = []
      let count = 0
      for (const event of taken)
        for (const { notification } of await notificationsOf(deps, tx, event, now)) {
          const created = await tx.notifications.create(notification)
          if (created === null) continue
          count += 1
          refs.push(...created.filter((d) => d.status === 'pending'))
        }
      await tx.outbox.markDispatched(
        taken.map((e) => e.id),
        now,
      )
      return { events: taken.length, written: count, pending: refs }
    },
    ROUTINE,
  )
  report.events += events
  report.notifications += written
  for (const ref of pending) if (await sendJob(deps, ref, now)) report.jobs += 1
  return events
}

/**
 * A batch that fails is taken again one event at a time, so one event that cannot be read does
 * not hold the outbox of every agency: that one is marked and left in the log. A failure of the
 * database that passes on its own (R2 of the tappa 8 review) marks nothing: the run stops and
 * the events wait in the outbox for the next one, a minute later at most.
 */
async function dispatchOneByOne(
  deps: DispatchDeps,
  report: DispatchReport,
): Promise<'done' | 'unavailable'> {
  for (let i = 0; i < DISPATCH_BATCH; i += 1) {
    try {
      if ((await dispatchBatch(deps, report, 1)) === 0) return 'done'
    } catch (error) {
      if (error instanceof StoreUnavailableError) return 'unavailable'
      await deps.uow.runAsSystem('notify.dispatch: an event that fails', async (tx) => {
        const [event] = await tx.outbox.takePending(1)
        if (!event) return
        deps.logger.error(
          { err: error, eventId: event.id, type: event.type },
          'outbox event not notified',
        )
        await tx.outbox.markDispatched([event.id], deps.clock.now())
      })
    }
  }
  return 'done'
}

export async function dispatchNotifications(deps: DispatchDeps): Promise<DispatchReport> {
  const report: DispatchReport = { events: 0, notifications: 0, jobs: 0 }
  for (let round = 0; round < MAX_BATCHES; round += 1) {
    let events: number
    try {
      events = await dispatchBatch(deps, report, DISPATCH_BATCH)
    } catch (error) {
      if (error instanceof StoreUnavailableError) {
        deps.logger.warn({ err: error }, 'outbox batch failed: the database, left for the next run')
        break
      }
      deps.logger.warn({ err: error }, 'outbox batch failed: one event at a time')
      if ((await dispatchOneByOne(deps, report)) === 'unavailable') {
        deps.logger.warn({}, 'outbox event failed: the database, left for the next run')
        break
      }
      continue
    }
    if (events < DISPATCH_BATCH) break
  }
  // the sweep (P2): claims left by a fallen process, then the deliveries whose time has come
  const now = deps.clock.now()
  const due = await deps.uow.runAsSystem(
    'notify.dispatch: deliveries due',
    async (tx) => {
      const released = await tx.notifications.releaseExpiredClaims(now, {
        maxAttempts: DELIVERY_ATTEMPTS,
        gaveUp: deps.t('notify.errors.other'),
      })
      const listed = await tx.notifications.listDue(now, SWEEP_BATCH)
      const seen = new Set(released.map((r) => r.id))
      return [...released, ...listed.filter((r) => !seen.has(r.id))]
    },
    ROUTINE,
  )
  if (due.length > 0) deps.logger.info({ deliveries: due.length }, 'notification deliveries due')
  for (const ref of due) if (await sendJob(deps, ref, now)) report.jobs += 1
  return report
}

/**
 * Job `notify.deliver_platform`: a group of the platform's, seen only by the system scope. Its
 * `tx` sees every agency, so the platform's kinds build their message from the payload alone.
 */
export async function deliverPlatformNotification(
  deps: DeliverDeps,
  job: { deliveryId?: unknown; recipientUserId?: unknown },
  signal?: AbortSignal,
): Promise<DeliverReport> {
  const { deliveryId, recipientUserId: userId } = job
  if (typeof deliveryId !== 'string' || !isUuid(deliveryId))
    throw new Error('notify.deliver_platform without deliveryId')
  if (typeof userId !== 'string' || !isUuid(userId))
    throw new Error('notify.deliver_platform without recipientUserId')
  return deliverGroup(
    deps,
    (fn) => deps.uow.runAsSystem('notify.deliver_platform: a platform notification', fn),
    { deliveryId, userId, organizationId: null },
    signal,
  )
}
