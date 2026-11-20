import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import type {
  IdGenerator,
  PublishingRepository,
  PublishingTargetRecord,
  TargetStepPatch,
} from '@app/application'
import {
  postStatusFromTargets,
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
    async dueTargets(now, limit) {
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
          and(inArray(postTargets.status, [...WORKER_STATES]), lte(postTargets.nextAttemptAt, now)),
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
    async targetsOfPost(organizationId, postId) {
      const rows = await db
        .select(targetColumns)
        .from(postTargets)
        .where(and(eq(postTargets.organizationId, organizationId), eq(postTargets.postId, postId)))
        .orderBy(asc(postTargets.createdAt), asc(postTargets.id))
      return rows.map(targetOf)
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
