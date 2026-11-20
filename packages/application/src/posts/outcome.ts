import { displayName, type OrgActor, type TargetStatus } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { AuditAction } from '../ports/audit-log.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { openPosts, postNotFound } from './common.js'

// The page of the outcome (plan 07 Task 9, Scelta 6): every destination of a post with its link
// or its reason, and the activity, from the log and from the calls to the platform. Every member
// of the workspace reads it, as the post (`workspace.view`). Codes only: the panel says them in
// words, and nothing of Meta's own messages leaves the server.

export interface DestinationOutcomeDto {
  accountId: string
  status: TargetStatus
  permalink: string | null
  publishedAt: string | null
  verifiedAt: string | null
  /** Feedway's code of the last error (`PUBLISH_ERROR_CODES`, `too_late`, `uncertain_not_found`) */
  errorCode: string | null
  /** why a destination is `problem` (§9.6): `not_found`, `failed`, `wrong_type`, `still_processing` */
  problem: string | null
  /** the next try of a destination `retrying` */
  nextAttemptAt: string | null
}

/** What the activity tells, from the log of the panel or from the calls of the worker. */
export const ACTIVITY_KINDS = [
  'post.created',
  'post.updated',
  'post.scheduled',
  'post.published_now',
  'post.unscheduled',
  'post.cancelled',
  'post.retried',
  'post.verified_manually',
  'post.target_cancelled',
  'post.resumed',
  'target.published',
  'target.failed',
  'target.uncertain',
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export interface ActivityDto {
  at: string
  kind: ActivityKind
  /** who did it in the panel; null for the worker */
  actorName: string | null
  /** the destination it is about, when it is about one */
  accountId: string | null
  errorCode: string | null
}

export interface PostOutcomeDto {
  destinations: DestinationOutcomeDto[]
  /** the latest first */
  activity: ActivityDto[]
}

/** Enough for a post's whole life: a few saves, a few tries on each account. */
const ACTIVITY_MAX = 50

const POST_ACTIONS = new Set<string>(ACTIVITY_KINDS.filter((k) => k.startsWith('post.')))

/** The reason of `problem`, as the verification saved it. */
function problemOf(status: TargetStatus, verification: unknown): string | null {
  if (status !== 'problem' || typeof verification !== 'object' || verification === null) return null
  const reason = (verification as { reason?: unknown }).reason
  return typeof reason === 'string' ? reason : null
}

const ATTEMPT_KIND: Record<string, ActivityKind | undefined> = {
  permanent: 'target.failed',
  uncertain: 'target.uncertain',
}

export async function getPostOutcome(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
): Promise<PostOutcomeDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openPosts(tx, actor, input.workspaceId, { write: false })
      if (!isUuid(input.postId)) throw postNotFound()
      const post = await tx.posts.find(scope, input.postId)
      if (!post) throw postNotFound()
      const targets = await tx.publishing.targetsOfPost(scope.organizationId, post.id)
      // one query at a time: the transaction has one connection
      const entries = await tx.audit.listForOrganization({
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        entity: 'post',
        entityId: post.id,
        limit: ACTIVITY_MAX,
      })
      const attempts = await tx.publishing.attemptsOfPost(
        scope.organizationId,
        post.id,
        ACTIVITY_MAX,
      )
      // the authors are or were people of the agency: they wrote on its post
      const people = new Map(
        (
          await tx.users.summaries([
            ...new Set(entries.flatMap((e) => (e.actorId === null ? [] : [e.actorId]))),
          ])
        ).map((u) => [u.id, u.anonymizedAt === null ? displayName(u) : null]),
      )
      const fromLog = entries
        .filter((e) => POST_ACTIONS.has(e.action))
        .map((e): ActivityDto => ({
          at: e.createdAt.toISOString(),
          kind: e.action as ActivityKind & AuditAction,
          actorName: e.actorId === null ? null : (people.get(e.actorId) ?? null),
          accountId: typeof e.data['accountId'] === 'string' ? e.data['accountId'] : null,
          errorCode: null,
        }))
      const fromCalls = attempts.flatMap((a): ActivityDto[] => {
        const kind =
          a.outcome === 'done'
            ? a.step === 'publish'
              ? 'target.published'
              : undefined
            : ATTEMPT_KIND[a.outcome]
        if (!kind) return []
        return [
          {
            at: a.createdAt.toISOString(),
            kind,
            actorName: null,
            accountId: a.accountId,
            errorCode: a.errorCode,
          },
        ]
      })
      return {
        destinations: targets.map((t) => ({
          accountId: t.accountId,
          status: t.status,
          permalink: t.permalink,
          publishedAt: t.publishedAt?.toISOString() ?? null,
          verifiedAt: t.verifiedAt?.toISOString() ?? null,
          errorCode: t.lastErrorCode,
          problem: problemOf(t.status, t.verification),
          nextAttemptAt: t.status === 'retrying' ? (t.nextAttemptAt?.toISOString() ?? null) : null,
        })),
        activity: [...fromLog, ...fromCalls]
          .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
          .slice(0, ACTIVITY_MAX),
      }
    },
  )
}
