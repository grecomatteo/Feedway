import type { PostStatus } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'

/**
 * The state of each post of the agency among these ids, in one query (plan 06, for stage 9):
 * inside the caller's transaction, whose scope is the agency. An id that is no post of the
 * agency is left out.
 */
export async function getStatuses(
  tx: Tx,
  organizationId: string,
  postIds: readonly string[],
): Promise<Map<string, PostStatus>> {
  const ids = [...new Set(postIds.filter(isUuid))]
  if (ids.length === 0) return new Map()
  return tx.posts.statuses(organizationId, ids)
}

/**
 * Whether the post is one of the client's (plan 09 Task 7, for the plan's read of the editor):
 * inside the caller's transaction, whose scope is the agency.
 */
export async function isPostOf(tx: Tx, scope: PostScope, postId: string): Promise<boolean> {
  return isUuid(postId) && (await tx.posts.find(scope, postId)) !== null
}
