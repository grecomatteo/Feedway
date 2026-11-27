import {
  COLLABORATOR_STATUSES,
  DomainError,
  can,
  roundIds,
  type CollaboratorStatus,
  type OrgActor,
} from '@app/domain'
import { isUuid } from '../../identity/index.js'
import type { CollaboratorsRefreshJobData, JobQueue } from '../../ports/job-queue.js'
import type { Logger } from '../../ports/logger.js'
import {
  PublishError,
  sentCollaboratorsOf,
  type CollaboratorsRead,
  type PlatformPublisher,
  type PublishTarget,
} from '../../ports/platform-publisher.js'
import type { PublishingTargetRecord } from '../../ports/publishing.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'
import { openPosts, postNotFound } from '../common.js'
import { readTargetOf, recordReadings, slowDownOf, type PublishingWorkerDeps } from './context.js'

// Instagram's collaborators (plan 09 Scelta 13, D-125): the worker invites them with the
// container (the publisher writes what it sent in the ids) and reads their answers once the
// post is confirmed, and again at «Aggiorna» on the page of the outcome. The web never calls
// Meta: it asks the worker (`posts.collaborators_refresh`) and reads again a few seconds later.

/** What `post_targets.collaborators` holds: the answers as the worker last read them. */
export interface CollaboratorsReading {
  readAt: string
  people: { username: string; status: CollaboratorStatus }[]
}

export function collaboratorsReadingOf(raw: unknown): CollaboratorsReading | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { readAt, people } = raw as { readAt?: unknown; people?: unknown }
  if (typeof readAt !== 'string' || !Array.isArray(people)) return null
  const known = new Set<string>(COLLABORATOR_STATUSES)
  return {
    readAt,
    people: people.flatMap((p: unknown) => {
      const { username, status } = (p ?? {}) as { username?: unknown; status?: unknown }
      return typeof username === 'string' && typeof status === 'string' && known.has(status)
        ? [{ username, status: status as CollaboratorStatus }]
        : []
    }),
  }
}

/**
 * How an invitation stands on the page of the outcome: `not_sent` when the platform refused it
 * (the post went out without), `waiting` until the worker read it, `unknown` when Meta did not
 * list the name (it lists only who has the collaboration tags on).
 */
export type InvitationStatus = CollaboratorStatus | 'not_sent' | 'waiting' | 'unknown'

export interface CollaboratorsOutcomeDto {
  /** in the order they were invited */
  people: { username: string; status: InvitationStatus }[]
  /** the platform's code when it refused the invitations; null: they went out */
  notSentCode: string | null
  /** when the worker last read the answers; null: never */
  readAt: string | null
}

/** The invitations of a destination, from what the publisher sent and the worker read. */
export function collaboratorsOutcomeOf(
  target: Pick<PublishingTargetRecord, 'metaIds' | 'collaborators'>,
): CollaboratorsOutcomeDto | null {
  const sent = sentCollaboratorsOf(roundIds(target.metaIds))
  if (sent === null) return null
  if (sent.dropped !== null)
    return {
      people: sent.names.map((username) => ({ username, status: 'not_sent' })),
      notSentCode: sent.dropped.platformCode,
      readAt: null,
    }
  const reading = collaboratorsReadingOf(target.collaborators)
  const answers = new Map(reading?.people.map((p) => [p.username.toLowerCase(), p.status]))
  return {
    people: sent.names.map((username) => ({
      username,
      status: reading === null ? 'waiting' : (answers.get(username.toLowerCase()) ?? 'unknown'),
    })),
    notSentCode: null,
    readAt: reading?.readAt ?? null,
  }
}

/** A destination whose invitations went out with its post, now published: there is something to read. */
export const hasInvitationsToRead = (
  target: Pick<PublishingTargetRecord, 'metaIds' | 'externalPostId' | 'status'>,
): boolean => {
  const sent = sentCollaboratorsOf(roundIds(target.metaIds))
  return (
    sent !== null &&
    sent.dropped === null &&
    target.externalPostId !== null &&
    target.status !== 'cancelled'
  )
}

/** Sends the read of a post's answers; a send that fails is logged, the page says nothing changed. */
export async function sendCollaboratorsRefresh(
  deps: { queue: Pick<JobQueue, 'send'>; logger: Logger },
  job: CollaboratorsRefreshJobData & { organizationId: string },
): Promise<boolean> {
  try {
    await deps.queue.send('posts.collaborators_refresh', job, { singletonKey: job.postId })
    return true
  } catch (error) {
    deps.logger.error({ err: error, postId: job.postId }, 'collaborators refresh not queued')
    return false
  }
}

/**
 * «Aggiorna» on the page of the outcome: whoever sees the post asks the worker to read the
 * answers again. 409 when nothing went out to be read.
 */
export async function requestCollaboratorsRefresh(
  deps: { uow: UnitOfWork; queue: Pick<JobQueue, 'send'>; logger: Logger },
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
): Promise<{ queued: true }> {
  const organizationId = actor.organizationId
  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: false })
    if (!isUuid(input.postId)) throw postNotFound()
    const post = await tx.posts.find(scope, input.postId)
    if (!post || !can(current, 'workspace.view', scope)) throw postNotFound()
    const targets = await tx.publishing.targetsOfPost(organizationId, post.id)
    if (!targets.some(hasInvitationsToRead))
      throw new DomainError('CONFLICT', 'Questo post non ha inviti usciti da rileggere', {
        reason: 'no_invitations',
      })
  })
  if (!(await sendCollaboratorsRefresh(deps, { organizationId, postId: input.postId })))
    throw new Error('collaborators refresh not queued')
  return { queued: true }
}

interface Read {
  record: PublishingTargetRecord
  target: PublishTarget
  publisher: PlatformPublisher & Required<Pick<PlatformPublisher, 'readCollaborators'>>
  connectionId: string
}

export interface CollaboratorsRefreshReport {
  read: number
  /** slowed down, or the account out of reach: the answers stay as last read */
  skipped: number
  failed: number
}

/**
 * `posts.collaborators_refresh` (plan 09 Task 15): the answers of every destination of the post
 * whose invitations went out, read from the platform outside the transaction and saved on the
 * destination. The calls count in the account's slowing down (D-111), and a slowed down account
 * is not read. A transient error fails the job, so the queue tries it again.
 */
export async function refreshCollaborators(
  deps: PublishingWorkerDeps,
  job: CollaboratorsRefreshJobData & { organizationId: string; signal?: AbortSignal },
): Promise<CollaboratorsRefreshReport> {
  if (!isUuid(job.organizationId)) throw new Error('collaborators job without organizationId')
  if (!isUuid(job.postId)) throw new Error('collaborators job without postId')
  const scope = { organizationId: job.organizationId, userId: null }
  const report: CollaboratorsRefreshReport = { read: 0, skipped: 0, failed: 0 }
  const reads = await deps.uow.run(scope, async (tx) => {
    const targets = (await tx.publishing.targetsOfPost(job.organizationId, job.postId)).filter(
      hasInvitationsToRead,
    )
    const [first] = targets
    if (first === undefined) return []
    const post = await tx.posts.find(
      { organizationId: job.organizationId, workspaceId: first.workspaceId },
      job.postId,
    )
    if (!post) return []
    const out: Read[] = []
    for (const record of targets) {
      if ((await slowDownOf(tx, record, 'prepare', deps.clock.now())) !== null) {
        report.skipped += 1
        continue
      }
      const opened = await readTargetOf(tx, deps, record, post)
      const publisher = opened?.publisher
      if (!opened || !publisher?.readCollaborators) {
        report.skipped += 1
        continue
      }
      out.push({
        record,
        target: opened.target,
        connectionId: opened.connectionId,
        publisher: publisher as Read['publisher'],
      })
    }
    return out
  })
  let retry: PublishError | null = null
  for (const read of reads) {
    let result: CollaboratorsRead
    try {
      result = await read.publisher.readCollaborators(
        read.target,
        job.signal ?? new AbortController().signal,
      )
    } catch (error) {
      report.failed += 1
      if (!(error instanceof PublishError)) throw error
      if (error.kind !== 'permanent') retry = error
      deps.logger.warn(
        { targetId: read.record.id, code: error.code, kind: error.kind },
        'collaborators not read',
      )
      continue
    }
    const now = deps.clock.now()
    await deps.uow.run(scope, async (tx) => {
      const target = await tx.publishing.lockTarget(read.record.organizationId, read.record.id)
      if (!target) return
      await recordReadings(tx, target, result, now)
      await tx.connections.recordUsage(target.organizationId, read.connectionId, result.usage)
      const reading: CollaboratorsReading = { readAt: now.toISOString(), people: result.people }
      await tx.publishing.saveStep(target.organizationId, target.id, { collaborators: reading })
    })
    report.read += 1
  }
  if (retry !== null) throw retry
  return report
}
