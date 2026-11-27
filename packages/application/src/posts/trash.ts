import { DomainError, TRASH_BATCH_MAX, can, type OrgActor } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { PostRecord, PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import { isEmptyDraft } from './calendar.js'
import {
  cannotEdit,
  lockedPost,
  mayEditContent,
  openPosts,
  postNotFound,
  recordPost,
  wrongState,
  type PostsDeps,
} from './common.js'

// «Eliminati» (plan 09 Scelta 12, D-124): «Elimina» of a draft or a cancelled post sends it to
// the client's «Eliminati», where it waits 30 days; «Ripristina» gives it back as it was (its
// state never changed); «Elimina per sempre» and «Svuota» delete it now. Who may do each is who
// may delete it today (`deletePost`): its author, or whoever may change anyone's post. Several
// posts go together or none does.

type Deps = Pick<PostsDeps, 'uow' | 'clock'>

/** From 1 to 100 post ids, each once. */
function batchOf(postIds: readonly string[]): string[] {
  const ids = [...new Set(postIds)]
  if (ids.length === 0 || ids.length > TRASH_BATCH_MAX || ids.length !== postIds.length)
    throw new DomainError(
      'VALIDATION',
      `Da 1 a ${String(TRASH_BATCH_MAX)} post alla volta, ognuno una volta`,
      { field: 'postIds' },
    )
  // a post of another workspace or agency is not found, whatever its id
  if (!ids.every(isUuid)) throw postNotFound()
  // always in the same order: two batches that share posts never wait for each other in a ring
  return ids.sort()
}

const notTrashed = () =>
  new DomainError('CONFLICT', 'Il post non è negli Eliminati', { reason: 'post_not_trashed' })

/** Every post of the batch, locked and checked before any is written: all or none. */
async function lockBatch(
  tx: Tx,
  actor: OrgActor,
  scope: PostScope,
  postIds: readonly string[],
): Promise<PostRecord[]> {
  const posts: PostRecord[] = []
  for (const id of postIds) {
    const post = await lockedPost(tx, scope, id, { trashed: true })
    if (!mayEditContent(actor, post)) throw cannotEdit()
    posts.push(post)
  }
  return posts
}

/**
 * «Elimina»: drafts and cancelled posts into «Eliminati», up to 100 at once. One already there
 * stays as it is; a post of any other state answers 409, and nothing moves.
 */
export async function trashPosts(
  deps: Deps,
  actor: OrgActor,
  input: { workspaceId: string; postIds: readonly string[] },
  request: { ip: string | null },
): Promise<{ postIds: string[] }> {
  const ids = batchOf(input.postIds)
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      const posts = await lockBatch(tx, current, scope, ids)
      for (const post of posts)
        if (post.status !== 'draft' && post.status !== 'cancelled')
          throw wrongState(post.status, 'delete')
      const at = deps.clock.now()
      const moved: string[] = []
      for (const post of posts.filter((p) => p.trashedAt === null)) {
        if (
          !(await tx.posts.setTrashed(scope, post.id, { at, by: current.userId }, current.userId))
        )
          throw postNotFound()
        await recordPost(tx, current, 'post.trashed', post, request.ip)
        moved.push(post.id)
      }
      return { postIds: moved }
    },
  )
}

/** «Ripristina» (and «Annulla» after «Elimina»): back out of «Eliminati», as they were. */
export async function restorePosts(
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string; postIds: readonly string[] },
  request: { ip: string | null },
): Promise<{ postIds: string[] }> {
  const ids = batchOf(input.postIds)
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      const posts = await lockBatch(tx, current, scope, ids)
      const restored: string[] = []
      for (const post of posts.filter((p) => p.trashedAt !== null)) {
        if (!(await tx.posts.setTrashed(scope, post.id, null, current.userId))) throw postNotFound()
        await recordPost(tx, current, 'post.restored', post, request.ip)
        restored.push(post.id)
      }
      return { postIds: restored }
    },
  )
}

/** More than anyone leaves in «Eliminati»: «Svuota» takes the rest at the next press. */
export const PURGE_ALL_MAX = 500

/**
 * «Elimina per sempre» of the posts chosen (each already in «Eliminati», or 409), or «Svuota»
 * (`all`): every post of the client in «Eliminati» the person may delete, one's own or, with
 * `post.manage_others`, everyone's. The plan's content of a post deleted for good is «Da
 * preparare» again (`ON DELETE SET NULL`).
 */
export async function purgePosts(
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string } & ({ postIds: readonly string[] } | { all: true }),
  request: { ip: string | null },
): Promise<{ deleted: number }> {
  const ids = 'postIds' in input ? batchOf(input.postIds) : null
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      if (ids !== null) {
        const posts = await lockBatch(tx, current, scope, ids)
        if (posts.some((p) => p.trashedAt === null)) throw notTrashed()
        for (const post of posts) {
          if (!(await tx.posts.delete(scope, post.id))) throw postNotFound()
          await recordPost(tx, current, 'post.deleted', post, request.ip)
        }
        return { deleted: posts.length }
      }
      const mayOthers = can(current, 'post.manage_others', scope)
      const candidates = await tx.posts.listForCalendar(scope.organizationId, [scope.workspaceId], {
        period: 'trashed',
        statuses: ['draft', 'cancelled'],
        types: [],
        authorIds: mayOthers ? [] : [current.userId],
        accountIds: [],
        labelIds: [],
        limit: PURGE_ALL_MAX,
      })
      let deleted = 0
      for (const candidate of [...candidates].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const post = await tx.posts.findForUpdate(scope, candidate.id)
        if (!post || post.trashedAt === null || !mayEditContent(current, post)) continue
        if (!(await tx.posts.delete(scope, post.id))) continue
        await recordPost(tx, current, 'post.deleted', post, request.ip)
        deleted++
      }
      return { deleted }
    },
  )
}

/**
 * `DELETE` of one post: «Elimina per sempre» of a post in «Eliminati», or a new draft left empty
 * by the editor (gone as if never born). Any other post goes to «Eliminati» first (409).
 */
export function assertDeletableNow(post: PostRecord): void {
  if (post.status !== 'draft' && post.status !== 'cancelled')
    throw wrongState(post.status, 'delete')
  if (post.trashedAt === null && !isEmptyDraft(post)) throw notTrashedYet()
}

export const notTrashedYet = () =>
  new DomainError(
    'CONFLICT',
    'Una bozza con qualcosa dentro va prima negli Eliminati: usa «Elimina»',
    {
      reason: 'post_not_trashed',
    },
  )
