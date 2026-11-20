import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type {
  IdGenerator,
  PublishingRepository,
  PublishingTargetRecord,
  TargetStepPatch,
} from '@app/application'
import {
  postStatusFromTargets,
  type AttemptOutcome,
  type PostType,
  type TargetStatus,
  type TargetStep,
} from '@app/domain'
import type { DbExecutor } from '../client.js'
import { posts, postTargets, targetAttempts } from './schema.js'

// The repository of the publishing (plan 07 Task 3). Every query but `dueTargets` filters by
// agency in SQL as well: row level security is the second barrier.

/** The states in which the worker has a step to do when `next_attempt_at` comes. */
const WORKER_STATES: readonly TargetStatus[] = [
  'scheduled',
  'preparing',
  'ready',
  'publishing',
  'retrying',
  'unknown',
  'published',
  'verifying',
]

/** The states a destination ends in; one of them keeps its copies for `MEDIA_RETENTION_DAYS`. */
const ENDED_STATES: readonly TargetStatus[] = ['confirmed', 'cancelled', 'failed', 'problem']

const targetColumns = {
  id: postTargets.id,
  organizationId: postTargets.organizationId,
  workspaceId: postTargets.workspaceId,
  postId: postTargets.postId,
  accountId: postTargets.accountId,
  status: postTargets.status,
  step: postTargets.step,
  generation: postTargets.generation,
  metaIds: postTargets.metaIds,
  externalPostId: postTargets.externalPostId,
  permalink: postTargets.permalink,
  attempts: postTargets.attempts,
  nextAttemptAt: postTargets.nextAttemptAt,
  lastErrorCode: postTargets.lastErrorCode,
  lastErrorMessage: postTargets.lastErrorMessage,
  publishedAt: postTargets.publishedAt,
  verifiedAt: postTargets.verifiedAt,
  verification: postTargets.verification,
}

type TargetRow = Omit<PublishingTargetRecord, 'status' | 'step' | 'metaIds'> & {
  status: string
  step: string | null
  metaIds: unknown
}

// the check constraints keep the values inside the lists
const targetOf = (row: TargetRow): PublishingTargetRecord => ({
  ...row,
  status: row.status as TargetStatus,
  step: row.step as TargetStep | null,
  metaIds: row.metaIds as Record<string, unknown> | null,
})

const targetKey = (organizationId: string, targetId: string) =>
  and(eq(postTargets.organizationId, organizationId), eq(postTargets.id, targetId))

export function drizzlePublishing(db: DbExecutor, ids: IdGenerator): PublishingRepository {
  return {
    async lockTarget(organizationId, targetId) {
      // the post first, then the destination: the panel's saves lock in this order too
      const [owner] = await db
        .select({ postId: postTargets.postId })
        .from(postTargets)
        .where(targetKey(organizationId, targetId))
      if (!owner) return null
      await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.organizationId, organizationId), eq(posts.id, owner.postId)))
        .for('update')
      const [row] = await db
        .select(targetColumns)
        .from(postTargets)
        .where(targetKey(organizationId, targetId))
        .for('update')
      return row ? targetOf(row) : null
    },
    async saveStep(organizationId, targetId, patch: TargetStepPatch) {
      const { renew = false, ...change } = patch
      const moved =
        change.status === undefined
          ? sql`false`
          : sql`${postTargets.status} is distinct from ${change.status}`
      const [row] = await db
        .update(postTargets)
        .set({
          ...change,
          generation: sql`${postTargets.generation} + case when ${moved} or ${renew} then 1 else 0 end`,
        })
        .where(targetKey(organizationId, targetId))
        .returning({
          postId: postTargets.postId,
          generation: postTargets.generation,
        })
      if (!row) return null
      // the post's row, held by `lockTarget` already: without it, two destinations moving
      // together would each read the other's old state and save a wrong post state
      await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.organizationId, organizationId), eq(posts.id, row.postId)))
        .for('update')
      const statuses = await db
        .select({ status: postTargets.status })
        .from(postTargets)
        .where(
          and(eq(postTargets.organizationId, organizationId), eq(postTargets.postId, row.postId)),
        )
      const postStatus = postStatusFromTargets(statuses.map((s) => s.status as TargetStatus))
      if (change.status !== undefined)
        await db
          .update(posts)
          // not the version: the panel's optimistic lock is for people's edits, and an edit
          // during the preparation is allowed (P2)
          .set({ status: postStatus })
          .where(
            and(
              eq(posts.organizationId, organizationId),
              eq(posts.id, row.postId),
              sql`${posts.status} is distinct from ${postStatus}`,
            ),
          )
      return { generation: row.generation, postStatus }
    },
    async recordAttempt(attempt) {
      await db.insert(targetAttempts).values({
        id: ids.newId(),
        organizationId: attempt.organizationId,
        workspaceId: attempt.workspaceId,
        targetId: attempt.targetId,
        step: attempt.step,
        outcome: attempt.outcome,
        errorCode: attempt.errorCode ?? null,
        metaErrorCode: attempt.metaErrorCode ?? null,
        durationMs: Math.max(0, Math.round(attempt.durationMs)),
      })
    },
    async claimPrepare(organizationId, targetId, claim) {
      // one claim at a time in the agency: two workers never both take the last place
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`publishing_prepare:${organizationId}`}))`,
      )
      const [target] = await db
        .select({ accountId: postTargets.accountId })
        .from(postTargets)
        .where(targetKey(organizationId, targetId))
      if (!target) return false
      const running = await db
        .select({ accountId: postTargets.accountId })
        .from(postTargets)
        .where(
          and(
            eq(postTargets.organizationId, organizationId),
            ne(postTargets.id, targetId),
            gt(postTargets.claimedUntil, claim.now),
          ),
        )
      if (
        running.length >= claim.perOrganization ||
        running.filter((r) => r.accountId === target.accountId).length >= claim.perAccount
      )
        return false
      await db
        .update(postTargets)
        .set({ claimedUntil: claim.until })
        .where(targetKey(organizationId, targetId))
      return true
    },
    async dueTargets(now, limit, statuses = WORKER_STATES) {
      const rows = await db
        .select({
          organizationId: postTargets.organizationId,
          workspaceId: postTargets.workspaceId,
          targetId: postTargets.id,
          status: postTargets.status,
          step: postTargets.step,
          generation: postTargets.generation,
          nextAttemptAt: postTargets.nextAttemptAt,
        })
        .from(postTargets)
        .where(
          and(
            inArray(
              postTargets.status,
              statuses.filter((s) => WORKER_STATES.includes(s)),
            ),
            lte(postTargets.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(postTargets.nextAttemptAt), asc(postTargets.id))
        .limit(limit)
      return rows.map((r) => ({
        ...r,
        status: r.status as TargetStatus,
        step: r.step as TargetStep | null,
        // `lte` keeps only the rows that have one
        nextAttemptAt: r.nextAttemptAt as Date,
      }))
    },
    async dueRechecks(now, limit) {
      return db
        .select({
          organizationId: postTargets.organizationId,
          targetId: postTargets.id,
          generation: postTargets.generation,
        })
        .from(postTargets)
        .where(lte(postTargets.recheckAt, now))
        .orderBy(asc(postTargets.recheckAt), asc(postTargets.id))
        .limit(limit)
    },
    async postsNeedingCopies(organizationId, endedAfter) {
      return db
        .selectDistinct({ postId: postTargets.postId, workspaceId: postTargets.workspaceId })
        .from(postTargets)
        .where(
          and(
            eq(postTargets.organizationId, organizationId),
            ne(postTargets.status, 'draft'),
            or(
              notInArray(postTargets.status, [...ENDED_STATES]),
              gt(postTargets.updatedAt, endedAfter),
            ),
          ),
        )
        .orderBy(asc(postTargets.postId), asc(postTargets.workspaceId))
    },
    async targetsOfPost(organizationId, postId) {
      const rows = await db
        .select(targetColumns)
        .from(postTargets)
        .where(and(eq(postTargets.organizationId, organizationId), eq(postTargets.postId, postId)))
        .orderBy(asc(postTargets.createdAt), asc(postTargets.id))
      return rows.map(targetOf)
    },
    async attemptsOfPost(organizationId, postId, limit) {
      const rows = await db
        .select({
          targetId: targetAttempts.targetId,
          accountId: postTargets.accountId,
          step: targetAttempts.step,
          outcome: targetAttempts.outcome,
          errorCode: targetAttempts.errorCode,
          createdAt: targetAttempts.createdAt,
        })
        .from(targetAttempts)
        .innerJoin(
          postTargets,
          and(
            eq(postTargets.organizationId, targetAttempts.organizationId),
            eq(postTargets.id, targetAttempts.targetId),
          ),
        )
        .where(
          and(
            eq(targetAttempts.organizationId, organizationId),
            eq(postTargets.postId, postId),
            inArray(targetAttempts.outcome, ['done', 'permanent', 'uncertain']),
          ),
        )
        .orderBy(desc(targetAttempts.createdAt), desc(targetAttempts.id))
        .limit(limit)
      return rows.map((row) => ({
        ...row,
        step: row.step as TargetStep,
        outcome: row.outcome as AttemptOutcome,
      }))
    },
    async publishedNear(organizationId, accountId, { from, to }) {
      const rows = await db
        .select({
          targetId: postTargets.id,
          postId: postTargets.postId,
          type: posts.type,
          externalPostId: postTargets.externalPostId,
          publishedAt: postTargets.publishedAt,
        })
        .from(postTargets)
        .innerJoin(
          posts,
          and(
            eq(posts.organizationId, postTargets.organizationId),
            eq(posts.id, postTargets.postId),
          ),
        )
        .where(
          and(
            eq(postTargets.organizationId, organizationId),
            eq(postTargets.accountId, accountId),
            gte(postTargets.publishedAt, from),
            lt(postTargets.publishedAt, to),
          ),
        )
        .orderBy(desc(postTargets.publishedAt), asc(postTargets.id))
      return rows.map((r) => ({
        ...r,
        type: r.type as PostType,
        // the range keeps only the rows that have one
        publishedAt: r.publishedAt as Date,
      }))
    },
  }
}
