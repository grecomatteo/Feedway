import { DomainError, can, storedTimeZone, type OrgActor } from '@app/domain'
import type { Tx } from '../ports/tx.js'
import {
  assertReferences,
  cannotEdit,
  captionByPlatformOf,
  changeOf,
  lockedPost,
  mergeContent,
  mayEditContent,
  openPosts,
  postNotFound,
  recordPost,
  scheduledAtOf,
  versionConflict,
  writeParts,
  wrongState,
  type PostContent,
  type PostsDeps,
  type UpdatePostInput,
} from './common.js'
import { readPost, type PostDto } from './read.js'
import { saveScheduled } from './schedule.js'

// Drafts (spec §11.2, plan 06 Task 4): a draft saves with any problem, the checks are the
// editor's to show. Writing takes `post.draft` on one's own drafts, `post.manage_others` on
// anyone's; every save carries the version it read (§11.9).

const DEFAULTS: Omit<PostContent, 'type'> = {
  mediaIds: [],
  cover: null,
  caption: { common: '' },
  destinations: [],
  when: null,
  shareToFeed: true,
  choices: [],
}

/** A new draft: its type, and whatever else the editor already has. */
export type CreateDraftInput = { workspaceId: string } & Pick<PostContent, 'type'> &
  Partial<Omit<PostContent, 'type'>> & {
    /** for the activity log */
    ip?: string | null
  }

/**
 * A new draft inside the caller's transaction (public, for stage 9). Its time zone is the
 * agency's of now (D-58).
 */
export async function createDraft(
  tx: Tx,
  actor: OrgActor,
  input: CreateDraftInput,
): Promise<{ postId: string }> {
  const { current, scope, organization } = await openPosts(tx, actor, input.workspaceId, {
    write: true,
  })
  if (!can(current, 'post.draft', scope))
    throw new DomainError('FORBIDDEN', 'Non puoi scrivere post in questo cliente')
  const content: PostContent = {
    type: input.type,
    mediaIds: input.mediaIds ?? DEFAULTS.mediaIds,
    cover: input.cover ?? DEFAULTS.cover,
    caption: input.caption ?? DEFAULTS.caption,
    destinations: input.destinations ?? DEFAULTS.destinations,
    when: input.when ?? DEFAULTS.when,
    shareToFeed: input.shareToFeed ?? DEFAULTS.shareToFeed,
    choices: input.choices ?? DEFAULTS.choices,
  }
  await assertReferences(tx, scope, content, null)
  const timezone = storedTimeZone(organization?.settings ?? {})
  const postId = await tx.posts.insert({
    ...scope,
    type: content.type,
    caption: content.caption.common,
    captionByPlatform: captionByPlatformOf(content.caption),
    scheduledAt: scheduledAtOf(content.when, timezone),
    timezone,
    options: { shareToFeed: content.shareToFeed, choices: [...content.choices] },
    createdBy: current.userId,
  })
  await writeParts(tx, scope, postId, content, 'draft')
  await recordPost(
    tx,
    current,
    'post.created',
    { id: postId, workspaceId: scope.workspaceId },
    input.ip ?? null,
  )
  return { postId }
}

/** «Nuovo post» of the panel: the draft is born at its first content (plan 06, Scelta 7). */
export async function createPost(
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: Omit<CreateDraftInput, 'ip'>,
  request: { ip: string | null },
): Promise<PostDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { postId } = await createDraft(tx, actor, { ...input, ip: request.ip })
      return readPost(
        tx,
        actor,
        { organizationId: actor.organizationId, workspaceId: input.workspaceId },
        postId,
      )
    },
  )
}

/**
 * Saves a post with the version read. A draft saves as it is (the editor's autosave); a
 * scheduled post saves only if its checks still pass, and stays scheduled; a cancelled post
 * does not change.
 */
export async function updatePost(
  deps: PostsDeps,
  actor: OrgActor,
  postId: string,
  input: UpdatePostInput,
  request: { ip: string | null },
): Promise<PostDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope, organization } = await openPosts(tx, actor, input.workspaceId, {
        write: true,
      })
      const post = await lockedPost(tx, scope, postId)
      if (!mayEditContent(current, post)) throw cannotEdit()
      if (post.version !== input.version) throw versionConflict()
      const content = mergeContent(post, input)
      await assertReferences(tx, scope, content, post)
      if (post.status === 'scheduled') {
        if (!organization) throw postNotFound()
        await saveScheduled(tx, deps, current, organization, post, content)
        // what goes out changes: unlike a draft's autosave, the log keeps it
        await recordPost(tx, current, 'post.updated', post, request.ip)
        return readPost(tx, current, scope, post.id)
      }
      if (post.status !== 'draft') throw wrongState(post.status, 'edit')
      const version = await tx.posts.update(
        scope,
        post.id,
        changeOf(post, content, current.userId, 'draft'),
        post.version,
      )
      if (version === null) throw versionConflict()
      await writeParts(tx, scope, post.id, content, 'draft')
      return readPost(tx, current, scope, post.id)
    },
  )
}

/** A draft or a cancelled post, by its author or by someone who may change anyone's. */
export async function deletePost(
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
  request: { ip: string | null },
): Promise<void> {
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
    const post = await lockedPost(tx, scope, input.postId)
    if (!mayEditContent(current, post)) throw cannotEdit()
    if (post.status === 'scheduled') throw wrongState(post.status, 'delete')
    if (!(await tx.posts.delete(scope, post.id))) throw postNotFound()
    await recordPost(tx, current, 'post.deleted', post, request.ip)
  })
}
