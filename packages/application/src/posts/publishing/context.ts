import {
  can,
  canMoveTarget,
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
import type { JobQueue, TargetJobData } from '../../ports/job-queue.js'
import type { Logger } from '../../ports/logger.js'
import type { ConnectionCredentials, PlatformConnectors } from '../../ports/platform-connector.js'
import type {
  PlatformPublisher,
  PlatformPublishers,
  PublishTarget,
} from '../../ports/platform-publisher.js'
import type { PostRecord } from '../../ports/posts.js'
import type { PublishingTargetRecord, TargetStepPatch } from '../../ports/publishing.js'
import type { PublishingHistory } from '../../ports/publishing-history.js'
import type { Tx } from '../../ports/tx.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'

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
  name: 'target.prepare' | 'target.publish'
  organizationId: string
  targetId: string
  generation: number
  startAfter?: Date
}

export const stepKey = (job: Pick<StepJob, 'name' | 'targetId' | 'generation'>) =>
  `${job.targetId}:${job.name === 'target.prepare' ? 'prepare' : 'publish'}:${String(job.generation)}`

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
    account: { platform: account.platform, externalId: account.externalId, pageId: account.pageId },
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

const eventOf = (target: PublishingTargetRecord, code: PublishErrorCode | null) => ({
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

export const plusMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000)

/** Where Meta downloads a copy (`/m/<token>.<ext>`, spec §16.1). */
export function publicFileUrl(base: URL, token: string, mime: string): string {
  return new URL(`/m/${token}.${mime === 'video/mp4' ? 'mp4' : 'jpg'}`, base).toString()
}
