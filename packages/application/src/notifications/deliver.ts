import { CLAIM_MS, afterFailure, displayName, type OutboxEventType } from '@app/domain'
import { isUuid } from '../identity/index.js'
import { usableTimeZone } from '../mail/index.js'
import type { NotificationKind } from '../module-definition.js'
import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import type {
  ChannelRecipient,
  NotificationChannel,
  RenderedMessage,
  SendResult,
} from '../ports/notification-channel.js'
import type { ClaimedDelivery, DeliveryOutcome } from '../ports/notifications.js'
import type { UserRecord } from '../ports/repositories.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { eligibleUser, placeOf } from './recipients.js'

// `notify.deliver` (plan 08 P1, «Ogni invio in transazione corta»): the job claims its group in
// one transaction and closes it, calls the channel, then saves the outcome in another. No call
// of the network holds a row. A process that falls between the send and the save leaves the
// group `sending`; past `claimed_until` the dispatcher sends it again, so one send at most is
// repeated per channel.

export interface DeliverDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  t: Translate
  panelUrl: URL
  defaultTimezone: string
  kinds: ReadonlyMap<OutboxEventType, NotificationKind>
  /** The channels that send; the panel's has no send (its row is the notification) */
  channels: readonly NotificationChannel[]
}

export interface DeliverJob {
  organizationId: string
  deliveryId: string
  recipientUserId: string
}

export type DeliverReport =
  | { outcome: 'nothing' }
  | { outcome: 'skipped'; deliveries: number; reason: string }
  | { outcome: 'sent'; deliveries: number }
  | { outcome: 'retry' | 'failed'; deliveries: number; error: string }

/** A transaction in the delivery's scope: the recipient's in the agency, the system's for the platform. */
export type DeliveryScope = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>

export function assertDeliverJob(job: Partial<DeliverJob>): asserts job is DeliverJob {
  if (typeof job.organizationId !== 'string' || !isUuid(job.organizationId))
    throw new Error('notify.deliver without organizationId')
  if (typeof job.deliveryId !== 'string' || !isUuid(job.deliveryId))
    throw new Error('notify.deliver without deliveryId')
  if (typeof job.recipientUserId !== 'string' || !isUuid(job.recipientUserId))
    throw new Error('notify.deliver without recipientUserId')
}

export function recipientOf(user: UserRecord, organizationId: string | null): ChannelRecipient {
  return { userId: user.id, organizationId, email: user.email, name: displayName(user) }
}

interface Prepared {
  ids: string[]
  channel: NotificationChannel
  recipient: ChannelRecipient
  message: RenderedMessage
  attempts: number
}

type Claim =
  | { kind: 'nothing' }
  | { kind: 'skipped'; deliveries: number; reason: string }
  | { kind: 'send'; prepared: Prepared }

async function claim(
  deps: DeliverDeps,
  tx: Tx,
  input: { deliveryId: string; userId: string; organizationId: string | null },
  now: Date,
  claimedUntil: Date,
): Promise<Claim> {
  const { t } = deps
  const group = await tx.notifications.claimGroup({
    deliveryId: input.deliveryId,
    userId: input.userId,
    organizationId: input.organizationId,
    now,
    claimedUntil,
  })
  const [first] = group
  if (!first) return { kind: 'nothing' }
  const skip = async (rows: readonly ClaimedDelivery[], reason: string) => {
    await tx.notifications.finishClaim(
      rows.map((r) => r.id),
      claimedUntil,
      { status: 'skipped', error: reason },
    )
    return rows.length
  }
  const { organizationId } = input
  // a suspended agency hears of nothing outside the panel (D-112 punto 6)
  if (organizationId !== null) {
    const organization = await tx.organizations.findById(organizationId)
    if (organization?.status !== 'active') {
      const reason = t('notify.skipped.suspended')
      return { kind: 'skipped', deliveries: await skip(group, reason), reason }
    }
  }
  const kind = deps.kinds.get(first.kind)
  if (!kind) throw new Error(`no kind of notification for ${first.kind}`)
  // who can no longer see what a notification is about gets nothing of it (Review Focus 3)
  const seen: ClaimedDelivery[] = []
  const unseen: ClaimedDelivery[] = []
  let user: UserRecord | null = null
  for (const row of group) {
    const current = await eligibleUser(
      tx,
      input.userId,
      { ...placeOf(organizationId, row.payload), workspaceId: row.workspaceId },
      kind.recipients,
    )
    if (current) {
      user = current
      seen.push(row)
    } else unseen.push(row)
  }
  if (unseen.length > 0) await skip(unseen, t('notify.skipped.noAccess'))
  if (!user || seen.length === 0) {
    const reason = t('notify.skipped.noAccess')
    return { kind: 'skipped', deliveries: unseen.length, reason }
  }
  const channel = deps.channels.find((c) => c.name === first.channel)
  const recipient = recipientOf(user, organizationId)
  if (!channel || !(await channel.isAvailable(tx, recipient))) {
    const reason = channel?.unavailable ?? t(`notify.skipped.${first.channel}`)
    return { kind: 'skipped', deliveries: await skip(seen, reason), reason }
  }
  const message = await kind.message(
    {
      tx,
      organizationId,
      userId: input.userId,
      t,
      panelUrl: deps.panelUrl,
      timeZone: usableTimeZone(user.timezone, deps.defaultTimezone),
    },
    seen.map((r) => ({
      eventId: r.eventId,
      type: r.kind,
      payload: r.payload,
      workspaceId: r.workspaceId,
      createdAt: r.createdAt,
    })),
  )
  if (!message) {
    const reason = t('notify.skipped.gone')
    return { kind: 'skipped', deliveries: await skip(seen, reason), reason }
  }
  return {
    kind: 'send',
    prepared: {
      ids: seen.map((r) => r.id),
      channel,
      recipient,
      message,
      attempts: Math.max(...seen.map((r) => r.attempts)),
    },
  }
}

async function sendOnce(
  deps: DeliverDeps,
  prepared: Prepared,
  signal: AbortSignal,
): Promise<SendResult> {
  try {
    return await prepared.channel.send(prepared.recipient, prepared.message, signal)
  } catch (error) {
    // a channel that throws is a bug or the network: tried again. Only the error's kind goes
    // to the log, since a provider's message can carry the address or the server's reply
    deps.logger.error(
      {
        error: error instanceof Error ? error.name : typeof error,
        channel: prepared.channel.name,
        deliveries: prepared.ids.length,
      },
      'notification channel threw',
    )
    return { outcome: 'failed', error: deps.t('notify.errors.other'), retry: true }
  }
}

/** One group of deliveries, in the scope `run` opens. */
export async function deliverGroup(
  deps: DeliverDeps,
  run: DeliveryScope,
  input: { deliveryId: string; userId: string; organizationId: string | null },
  signal: AbortSignal = new AbortController().signal,
): Promise<DeliverReport> {
  const now = deps.clock.now()
  const claimedUntil = new Date(now.getTime() + CLAIM_MS)
  const claimed = await run((tx) => claim(deps, tx, input, now, claimedUntil))
  if (claimed.kind === 'nothing') return { outcome: 'nothing' }
  if (claimed.kind === 'skipped')
    return { outcome: 'skipped', deliveries: claimed.deliveries, reason: claimed.reason }
  const { prepared } = claimed
  const result = await sendOnce(deps, prepared, signal)
  let outcome: DeliveryOutcome
  let report: DeliverReport
  if (result.outcome === 'sent') {
    outcome = { status: 'sent' }
    report = { outcome: 'sent', deliveries: prepared.ids.length }
  } else {
    const { retryAt } = result.retry
      ? afterFailure(prepared.attempts, deps.clock.now())
      : { retryAt: null }
    outcome =
      retryAt === null
        ? { status: 'failed', error: result.error }
        : { status: 'pending', nextAttemptAt: retryAt, error: result.error }
    report = {
      outcome: retryAt === null ? 'failed' : 'retry',
      deliveries: prepared.ids.length,
      error: result.error,
    }
  }
  const saved = await run((tx) => tx.notifications.finishClaim(prepared.ids, claimedUntil, outcome))
  if (saved !== prepared.ids.length)
    // the claim ran out before the save: the sweep took it back, and may send it once more
    deps.logger.warn(
      { channel: prepared.channel.name, deliveries: prepared.ids.length, saved },
      'notification claim expired before its outcome was saved',
    )
  return report
}

/** Job `notify.deliver`: a group of an agency, in the recipient's scope there. */
export async function deliverNotification(
  deps: DeliverDeps,
  job: Partial<DeliverJob>,
  signal?: AbortSignal,
): Promise<DeliverReport> {
  assertDeliverJob(job)
  const { organizationId, recipientUserId: userId, deliveryId } = job
  return deliverGroup(
    deps,
    (fn) => deps.uow.run({ organizationId, userId }, fn),
    { deliveryId, userId, organizationId },
    signal,
  )
}
