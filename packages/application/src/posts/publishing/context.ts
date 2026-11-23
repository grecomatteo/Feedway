import {
  LATEST_START_MINUTES,
  MAX_LATENESS_MINUTES,
  PUBLISH_ERROR_CODES,
  can,
  canMoveTarget,
  publishedCaption,
  roundIds,
  slowDownUntil,
  type OrgActor,
  type Platform,
  type PlatformRules,
  type PublishErrorCode,
  type RuleReport,
  type TargetStatus,
} from '@app/domain'
import { isUuid } from '../../identity/index.js'
import type { ConnectionTokens } from '../../ports/connection-tokens.js'
import type { Clock } from '../../ports/clock.js'
import type { IdGenerator } from '../../ports/id-generator.js'
import type { Storage } from '../../ports/storage.js'
import type { JobQueue, TargetJobData } from '../../ports/job-queue.js'
import type { Logger } from '../../ports/logger.js'
import type { ConnectionCredentials, PlatformConnectors } from '../../ports/platform-connector.js'
import type {
  PlatformLoad,
  PlatformPublisher,
  PlatformPublishers,
  PlatformQuota,
  PublishTarget,
} from '../../ports/platform-publisher.js'
import type { PostRecord } from '../../ports/posts.js'
import type { PublishingTargetRecord, TargetStepPatch } from '../../ports/publishing.js'
import type { PublishingHistory } from '../../ports/publishing-history.js'
import type { Tx } from '../../ports/tx.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'
import { retriedAtOf } from './retry-mark.js'

// What the jobs of the publishing share (plan 07 Task 7): who published, the way to the
// platform, the moves of a destination with their events. Every step reads its destination
// locked, closes the transaction before calling Meta and opens a new one for the outcome.

export interface PublishingWorkerDeps {
  uow: UnitOfWork
  clock: Clock
  queue: Pick<JobQueue, 'send'>
  logger: Logger
  publishers: PlatformPublishers
  connectors: PlatformConnectors
  connectionTokens: ConnectionTokens
  platformRules: ReadonlyMap<Platform, PlatformRules>
  publishingHistory: PublishingHistory
  /** PUBLIC_URL: where Meta downloads the copies (`/m/*`); null: the public host is off. */
  publicUrl: URL | null
  ids: IdGenerator
  newPublicToken: () => string
  /** Where the copies are: a cover is read from here when the platform takes its bytes. */
  storage: Pick<Storage, 'get'>
}

/** A job of one step, as the worker hands it. */
export type TargetJob = TargetJobData & {
  organizationId: string
  jobId?: string
  signal?: AbortSignal
}

/** What a step did, for the job's log line: ids and codes only. */
export type StepLog =
  | { outcome: 'skipped'; why: string }
  | { outcome: 'moved'; to: TargetStatus; code?: string }
  | { outcome: 'waiting'; why: string }

export const skipped = (why: string): StepLog => ({ outcome: 'skipped', why })

/** A job of a step for a destination at its generation (P3): one job per key, even if sent twice. */
export interface StepJob {
  name: 'target.prepare' | 'target.publish' | 'target.reconcile' | 'target.verify'
  organizationId: string
  targetId: string
  generation: number
  startAfter?: Date
  /**
   * The reconciler's resend of a job used up without moving its destination (a job that
   * failed, kept a day under its key): a new key every `RESEND_EVERY_MINUTES`. A job of the
   * same generation twice is harmless, the step reads the destination locked.
   */
  resend?: number
}

export const stepKey = (job: Pick<StepJob, 'name' | 'targetId' | 'generation' | 'resend'>) => {
  const key = `${job.targetId}:${job.name.slice('target.'.length)}:${String(job.generation)}`
  return job.resend ? `${key}:r${String(job.resend)}` : key
}

/**
 * Sends the next steps after the commit. A failed send is not lost: the destination has its
 * `next_attempt_at`, and the reconciler sends it again within a minute.
 */
export async function sendSteps(
  deps: Pick<PublishingWorkerDeps, 'queue' | 'logger'>,
  jobs: readonly StepJob[],
): Promise<void> {
  for (const job of jobs) {
    try {
      await deps.queue.send(
        job.name,
        { organizationId: job.organizationId, targetId: job.targetId, generation: job.generation },
        {
          dedupeKey: stepKey(job),
          ...(job.startAfter === undefined ? {} : { startAfter: job.startAfter }),
        },
      )
    } catch (error) {
      deps.logger.error({ err: error, targetId: job.targetId }, 'publishing step not queued')
    }
  }
}

/** A job whose ids are not ones is a bug of its producer: it fails at once. */
export function assertTargetJob(job: TargetJob): void {
  if (!isUuid(job.organizationId)) throw new Error('publishing job without organizationId')
  if (!isUuid(job.targetId)) throw new Error('publishing job without targetId')
  if (!Number.isInteger(job.generation) || job.generation < 0)
    throw new Error('publishing job without generation')
}

/**
 * The person whose «Programma» the post goes out with (P6, `scheduled_by`), if they still
 * may publish it: active in the agency, not disabled, with `post.publish` on the client.
 */
export async function publisherOf(tx: Tx, post: PostRecord): Promise<OrgActor | null> {
  const userId = post.scheduledBy
  if (userId === null) return null
  const membership = await tx.orgMembers.find(post.organizationId, userId)
  if (membership?.status !== 'active') return null
  const user = await tx.users.findById(userId)
  if (user?.status !== 'active') return null
  const actor: OrgActor = {
    userId,
    platformRole: null,
    organizationId: post.organizationId,
    orgRole: membership.role,
    memberships: await tx.workspaceMembers.rolesOf(post.organizationId, userId),
  }
  return can(actor, 'post.publish', {
    organizationId: post.organizationId,
    workspaceId: post.workspaceId,
    ownerId: post.createdBy,
  })
    ? actor
    : null
}

/** The way to the account's platform for this step; null: the account cannot be reached. */
export async function openAccount(
  tx: Tx,
  deps: Pick<PublishingWorkerDeps, 'connectors' | 'connectionTokens' | 'publishers'>,
  organizationId: string,
  accountId: string,
): Promise<{
  account: PublishTarget['account']
  connectionId: string
  credentials: ConnectionCredentials
  publisher: PlatformPublisher
} | null> {
  const account = await tx.accounts.findById(organizationId, accountId)
  if (!account?.active) return null
  const publisher = deps.publishers[account.platform]
  if (!publisher) throw new Error(`no publisher for ${account.platform}`)
  const connection = await tx.connections.findWithToken(organizationId, account.connectionId)
  if (!connection || (connection.status !== 'active' && connection.status !== 'pending'))
    return null
  const connector = deps.connectors[connection.kind]
  if (!connector) throw new Error(`no platform connector for ${connection.kind}`)
  const app = await connector.loadAppCredentials(tx, organizationId)
  if (app === null) return null
  const token = await deps.connectionTokens.open(tx, {
    organizationId,
    id: connection.id,
    tokenEnc: connection.tokenEnc,
  })
  return {
    account: {
      platform: account.platform,
      externalId: account.externalId,
      pageId: account.pageId,
      scopes: connection.scopes,
    },
    connectionId: connection.id,
    credentials: { app, token },
    publisher,
  }
}

/** The blocks of the checks that concern one destination, or the post as a whole. */
export function blocksOf(report: RuleReport, accountId: string): string[] {
  const destination = report.destinations.find((d) => d.accountId === accountId)
  if (!destination) return ['destination_left_out']
  const keys = new Set([...destination.outcomeKeys, ...report.postKeys])
  return report.outcomes.filter((o) => o.level === 'block' && keys.has(o.key)).map((o) => o.code)
}

/**
 * A move of the worker on a destination locked by `lockTarget`, with the post's state saved
 * with it. A move the state machine does not allow is a bug, never written.
 */
export async function moveTarget(
  tx: Tx,
  target: PublishingTargetRecord,
  to: TargetStatus,
  patch: Omit<TargetStepPatch, 'status'> = {},
): Promise<number> {
  if (to !== target.status && !canMoveTarget(target.status, to, 'worker'))
    throw new Error(`the worker cannot move a destination from ${target.status} to ${to}`)
  const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
    ...patch,
    status: to,
  })
  if (!saved) throw new Error('destination gone while locked')
  return saved.generation
}

export const eventOf = (target: PublishingTargetRecord, code: PublishErrorCode | null) => ({
  postId: target.postId,
  targetId: target.id,
  accountId: target.accountId,
  workspaceId: target.workspaceId,
  ...(code === null ? {} : { code }),
})

/** `failed` with its code, and the events stage 8 tells of (§12.2). */
export async function failTarget(
  tx: Tx,
  target: PublishingTargetRecord,
  code: PublishErrorCode,
): Promise<StepLog> {
  await moveTarget(tx, target, 'failed', {
    lastErrorCode: code,
    lastErrorMessage: null,
    nextAttemptAt: null,
    claimedUntil: null,
  })
  await tx.outbox.record({
    organizationId: target.organizationId,
    type: 'post.target_failed',
    payload: eventOf(target, code),
  })
  if (code === 'file_wont_publish')
    await tx.outbox.record({
      organizationId: target.organizationId,
      type: 'post.file_wont_publish',
      payload: eventOf(target, null),
    })
  return { outcome: 'moved', to: 'failed', code }
}

/**
 * `paused` (plan 07 «Pausa»): the person who scheduled may no longer publish, or the agency is
 * suspended, which hears of nothing (no event).
 */
export async function pauseTarget(
  tx: Tx,
  target: PublishingTargetRecord,
  code: 'author_lost_permission' | 'organization_suspended',
): Promise<StepLog> {
  await moveTarget(tx, target, 'paused', {
    lastErrorCode: code,
    lastErrorMessage: null,
    nextAttemptAt: null,
    claimedUntil: null,
  })
  if (code !== 'organization_suspended')
    await tx.outbox.record({
      organizationId: target.organizationId,
      type: 'post.paused',
      payload: eventOf(target, code),
    })
  return { outcome: 'moved', to: 'paused', code }
}

/**
 * The client of the destination was archived (D-70): it publishes nothing. A plain read, not
 * through the author's visibility: the archiving waits for the post this step holds, and then
 * brings back to draft what is still in the panel's reach. A client not found publishes nothing
 * either.
 */
export async function clientArchived(tx: Tx, target: PublishingTargetRecord): Promise<boolean> {
  const workspace = await tx.workspaces.findById(target.organizationId, target.workspaceId)
  return workspace === null || workspace.archivedAt !== null
}

/**
 * `cancelled` (review R7): a destination of an archived client that has not started publishing,
 * left by the archiving because another destination of its post was already out. No event: the
 * person who archived knows.
 */
export async function cancelArchived(tx: Tx, target: PublishingTargetRecord): Promise<StepLog> {
  await moveTarget(tx, target, 'cancelled', {
    nextAttemptAt: null,
    claimedUntil: null,
    recheckAt: null,
  })
  return { outcome: 'moved', to: 'cancelled', code: 'client_archived' }
}

/**
 * D-118: the moment past which nothing of a publication goes on, but a file being processed;
 * a wait or a new attempt set after it fails at once instead of waiting for nothing.
 */
export const lateLimitOf = (
  scheduledAt: Date,
  target: Pick<PublishingTargetRecord, 'verification'>,
): Date => plusMinutes(latestOf(scheduledAt, retriedAtOf(target)), MAX_LATENESS_MINUTES)

/** R4: the moment past which nothing of the first publication starts any more. */
export const latestStartOf = (
  scheduledAt: Date,
  target: Pick<PublishingTargetRecord, 'verification'>,
): Date => plusMinutes(latestOf(scheduledAt, retriedAtOf(target)), LATEST_START_MINUTES)

const KNOWN_CODES = new Set<string>(PUBLISH_ERROR_CODES)

/**
 * Why a destination past the 60 minutes did not go out (R4): the error it was trying again
 * after, if any (the quota, Meta's load), else `too_late`.
 */
export function lateCodeOf(target: PublishingTargetRecord): PublishErrorCode {
  const last = target.lastErrorCode
  return target.status === 'retrying' && last !== null && KNOWN_CODES.has(last)
    ? (last as PublishErrorCode)
    : 'too_late'
}

/** The step looks again at `at`, in a new generation: the job of this one has been used. */
export async function waitTarget(
  tx: Tx,
  target: PublishingTargetRecord,
  name: StepJob['name'],
  at: Date,
  why: string,
  patch: Omit<TargetStepPatch, 'renew' | 'nextAttemptAt'> = {},
): Promise<{ log: StepLog; job: StepJob }> {
  const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
    claimedUntil: null,
    ...patch,
    nextAttemptAt: at,
    renew: true,
  })
  if (!saved) throw new Error('destination gone while locked')
  return {
    log: { outcome: 'waiting', why },
    job: {
      name,
      organizationId: target.organizationId,
      targetId: target.id,
      generation: saved.generation,
      startAfter: at,
    },
  }
}

/** The latest of the times given, nulls left out. */
export const latestOf = (first: Date, ...others: (Date | null)[]): Date =>
  others.reduce<Date>((a, b) => (b !== null && b > a ? b : a), first)

export const plusMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000)

/** Where Meta downloads a copy (`/m/<token>.<ext>`, spec §16.1). */
export function publicFileUrl(base: URL, token: string, mime: string): string {
  return new URL(`/m/${token}.${mime === 'video/mp4' ? 'mp4' : 'jpg'}`, base).toString()
}

/** Below this share of its quota left, the account is told nearly out (`account.quota_low`). */
export const QUOTA_LOW_BELOW = 0.1

/**
 * What an answer said of the platform's limits, saved on the account for the next steps (§8.6):
 * the usage, which slows down the account or the agency, and the quota, which is told once per
 * window when nearly over (plan 07 «Eventi»). An answer that said nothing leaves the last one.
 */
export async function recordReadings(
  tx: Tx,
  target: PublishingTargetRecord,
  answer: { load: PlatformLoad | null; quota?: PlatformQuota | undefined },
  at: Date,
): Promise<void> {
  const { organizationId, accountId } = target
  const { load, quota } = answer
  if (load && (load.accountPercent !== null || load.appPercent !== null))
    await tx.accounts.recordUsageReading(organizationId, accountId, { ...load, readAt: at })
  if (!quota || quota.total <= 0) return
  await tx.accounts.recordQuota(organizationId, accountId, quota, at)
  const left = Math.max(0, quota.total - quota.used)
  if (left >= quota.total * QUOTA_LOW_BELOW) return
  const since = new Date(at.getTime() - quota.windowSeconds * 1000)
  if (await tx.accounts.markQuotaLow(organizationId, accountId, at, since))
    await tx.outbox.record({
      organizationId,
      type: 'account.quota_low',
      payload: { accountId, left, total: quota.total },
    })
}

/**
 * When the step may run, slowed down by the usage the last answers said (§8.6); null: now.
 * `publish` waits only above 95%, so a post does not miss its time.
 */
export async function slowDownOf(
  tx: Tx,
  target: PublishingTargetRecord,
  step: 'prepare' | 'publish',
  now: Date,
): Promise<Date | null> {
  const readings = await tx.accounts.usageReadings(target.organizationId, target.accountId)
  return slowDownUntil(step, readings, now)
}

/**
 * What a reading step (the search, the verification) hands the platform: the destination as it
 * went out, without the checks of a publication (the person who scheduled may be gone, the post
 * may be read all the same). null: the account cannot be reached.
 */
export async function readTargetOf(
  tx: Tx,
  deps: Pick<PublishingWorkerDeps, 'connectors' | 'connectionTokens' | 'publishers'>,
  target: PublishingTargetRecord,
  post: PostRecord,
): Promise<{ target: PublishTarget; publisher: PlatformPublisher; connectionId: string } | null> {
  const opened = await openAccount(tx, deps, target.organizationId, target.accountId)
  if (!opened) return null
  return {
    publisher: opened.publisher,
    connectionId: opened.connectionId,
    target: {
      targetId: target.id,
      account: opened.account,
      credentials: opened.credentials,
      type: post.type,
      // Facebook: a reel beyond its length went out as a video, by the choice of the editor
      asVideo:
        post.type === 'reel' && post.options.choices.some((c) => c.option === 'publish_as_video'),
      caption: publishedCaption(
        { type: post.type, caption: { common: post.caption, ...post.captionByPlatform } },
        opened.account.platform,
      ),
      shareToFeed: post.options.shareToFeed,
      metaIds: roundIds(target.metaIds),
      externalPostId: target.externalPostId,
    },
  }
}

/**
 * `confirmed` (§9.6) with the post's link, and the events: this destination, and the post once
 * every destination not cancelled is confirmed.
 */
export async function confirmTarget(
  tx: Tx,
  target: PublishingTargetRecord,
  fields: {
    permalink: string | null
    at: Date
    verification: Record<string, unknown>
    /** «Segna come verificato» is the panel's move from `problem` */
    by?: 'panel' | 'worker'
  },
): Promise<StepLog> {
  const patch = {
    permalink: fields.permalink ?? target.permalink,
    verifiedAt: fields.at,
    verification: fields.verification,
    nextAttemptAt: null,
    lastErrorCode: null,
  }
  if (fields.by === 'panel') {
    if (!canMoveTarget(target.status, 'confirmed', 'panel'))
      throw new Error(`the panel cannot confirm a destination in ${target.status}`)
    const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
      ...patch,
      status: 'confirmed',
    })
    if (!saved) throw new Error('destination gone while locked')
  } else await moveTarget(tx, target, 'confirmed', patch)
  await tx.outbox.record({
    organizationId: target.organizationId,
    type: 'post.target_confirmed',
    payload: eventOf(target, null),
  })
  const all = await tx.publishing.targetsOfPost(target.organizationId, target.postId)
  const live = all.filter((t) => t.status !== 'cancelled')
  if (live.every((t) => t.status === 'confirmed'))
    await tx.outbox.record({
      organizationId: target.organizationId,
      type: 'post.confirmed',
      payload: { postId: target.postId, workspaceId: target.workspaceId },
    })
  return { outcome: 'moved', to: 'confirmed' }
}
