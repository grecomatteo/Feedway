import {
  BULK_ROW_CODES_MAX,
  DomainError,
  can,
  type BulkDraftReason,
  type OrgActor,
  type RuleReport,
} from '@app/domain'
import type { Tx } from '../ports/tx.js'
import { checkPostInTx } from '../rules/index.js'
import {
  assertDailyLimit,
  mayPublish,
  openPosts,
  postNotFound,
  recordPost,
  versionConflict,
  type PostsDeps,
} from './common.js'
import { createDraft, type CreateDraftInput } from './drafts.js'
import { NOTHING_AFTER, scheduleSaved, type AfterSchedule } from './schedule.js'
import { toCheckInput } from './to-check-input.js'

// One post of an import in bulk or of «Duplica» (plan 09 Task 10, P5): the draft and, when its
// checks pass, its scheduling, in the caller's transaction. Nothing that the checks say makes it
// throw: a row that cannot be scheduled stays a draft, with why; only what would refuse the draft
// itself (a file of another client, a person who may not write) throws, and the caller's
// transaction is rolled back.

export type CreatedPost =
  | { status: 'scheduled'; postId: string; version: number }
  | {
      status: 'draft'
      postId: string
      version: number
      reason: BulkDraftReason
      codes: string[]
    }

/** The codes of what blocks the post and of the warnings without a choice, each once. */
export function blockingCodes(report: RuleReport): string[] {
  const unresolved = new Set(report.unresolved)
  const codes = report.outcomes
    .filter((o) => o.level === 'block' || unresolved.has(o.key))
    .map((o) => o.code)
  return [...new Set(codes)].slice(0, BULK_ROW_CODES_MAX)
}

/**
 * A new post of the workspace, scheduled if `schedule` and its checks pass, a draft otherwise
 * (public, for stage 9). Scheduling takes `post.publish`, as «Programma»; the jobs to send after
 * the commit are in `after`.
 */
export async function createScheduled(
  tx: Tx,
  deps: PostsDeps,
  actor: OrgActor,
  input: CreateDraftInput & { schedule: boolean },
): Promise<{ post: CreatedPost; after: AfterSchedule }> {
  const { schedule, ...draft } = input
  const { postId } = await createDraft(tx, actor, draft)
  const { current, scope, organization } = await openPosts(tx, actor, input.workspaceId, {
    write: true,
  })
  if (!organization) throw postNotFound()
  const saved = await tx.posts.find(scope, postId)
  if (!saved) throw postNotFound()
  const asDraft = (reason: BulkDraftReason, codes: string[] = []) => ({
    post: { status: 'draft' as const, postId, version: saved.version, reason, codes },
    after: NOTHING_AFTER,
  })
  if (!schedule) return asDraft('asked')
  if (!mayPublish(current, saved)) return asDraft('not_allowed')
  if (saved.scheduledAt === null) return asDraft('no_date')
  // one at a time in the agency, as «Programma»: the posts of a day, and a file deleted meanwhile
  await tx.posts.lockSchedule(scope.organizationId)
  const report = await checkPostInTx(tx, deps, current, toCheckInput(saved, 'save'))
  if (!report.canSchedule) return asDraft('blocked', blockingCodes(report))
  try {
    await assertDailyLimit(tx, organization, saved, saved.scheduledAt)
  } catch (error) {
    if (error instanceof DomainError && error.code === 'LIMIT_REACHED')
      return asDraft('limit_reached')
    throw error
  }
  const version = await tx.posts.update(
    scope,
    postId,
    {
      type: saved.type,
      caption: saved.caption,
      captionByPlatform: saved.captionByPlatform,
      scheduledAt: saved.scheduledAt,
      status: 'scheduled',
      options: saved.options,
      scheduledBy: current.userId,
      updatedBy: current.userId,
    },
    saved.version,
  )
  if (version === null) throw versionConflict()
  const after = await scheduleSaved(tx, deps, current, organization, scope, postId, null, {
    checked: report,
  })
  await recordPost(tx, current, 'post.scheduled', saved, input.ip ?? null)
  return { post: { status: 'scheduled', postId, version }, after }
}

/** Whether the person may start an import in bulk in the workspace (§10.2: from Publisher). */
export const mayImportInBulk = (
  actor: OrgActor,
  scope: { organizationId: string; workspaceId: string },
) => can(actor, 'post.publish', scope)
