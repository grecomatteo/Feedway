import {
  DomainError,
  can,
  instantToZoned,
  type OrgActor,
  type PostCover,
  type PostStatus,
  type PostType,
  type RuleChoice,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import { getMediaForPosts, type PostMediaView } from '../media/index.js'
import type { PostRecord, PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { openPosts, postNotFound } from './common.js'

// Reading the posts of a workspace (plan 06 Task 4): every member of the workspace, the
// Viewer included (`workspace.view`, §10.2).

/** A file of the post: as the workspace has it now, or only its id once deleted. */
export interface PostMediaDto {
  id: string
  status: PostMediaView['status']
  kind: PostMediaView['kind'] | null
  originalName: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  /** of the copy that is published (D-60) */
  fps: number | null
  variants: string[]
}

export interface PostDto {
  id: string
  workspaceId: string
  type: PostType
  status: PostStatus
  version: number
  media: PostMediaDto[]
  cover: PostCover | null
  caption: { common: string; instagram?: string; facebook?: string }
  destinations: { accountId: string; status: PostStatus }[]
  when: { localDate: string; localTime: string } | null
  scheduledAt: string | null
  timezone: string
  shareToFeed: boolean
  choices: RuleChoice[]
  labelIds: string[]
  createdBy: string
  scheduledBy: string | null
  updatedBy: string
  createdAt: string
  updatedAt: string
  /** in «Eliminati» since (plan 09 Scelta 12): the editor shows it read-only, with «Ripristina» */
  trashedAt: string | null
}

const gone = (id: string): PostMediaDto => ({
  id,
  status: 'deleted',
  kind: null,
  originalName: null,
  sizeBytes: null,
  width: null,
  height: null,
  durationMs: null,
  fps: null,
  variants: [],
})

export function toPostDto(
  post: PostRecord,
  media: ReadonlyMap<string, PostMediaView>,
  opts: { names: boolean },
): PostDto {
  const file = (id: string): PostMediaDto => {
    const found = media.get(id)
    if (!found || found.status === 'deleted') return gone(id)
    // a file's name can be a person's: only who uses the library reads it (D-72)
    return opts.names ? found : { ...found, originalName: null }
  }
  return {
    id: post.id,
    workspaceId: post.workspaceId,
    type: post.type,
    status: post.status,
    version: post.version,
    media: post.mediaIds.map(file),
    cover: post.cover,
    caption: { common: post.caption, ...post.captionByPlatform },
    destinations: post.targets.map((t) => ({
      accountId: t.accountId,
      status: t.status,
      cancelledInPanel: t.cancelledInPanel,
    })),
    when:
      post.scheduledAt === null
        ? null
        : (({ localDate, localTime }) => ({ localDate, localTime }))(
            instantToZoned(post.scheduledAt, post.timezone),
          ),
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    timezone: post.timezone,
    shareToFeed: post.options.shareToFeed,
    choices: post.options.choices,
    labelIds: post.labelIds,
    createdBy: post.createdBy,
    scheduledBy: post.scheduledBy,
    updatedBy: post.updatedBy,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    trashedAt: post.trashedAt?.toISOString() ?? null,
  }
}

/** The posts as the panel sees them, with their files read in one go. */
export async function postDtos(
  tx: Tx,
  actor: OrgActor,
  scope: PostScope,
  posts: readonly PostRecord[],
) {
  const names = can(actor, 'media.upload', scope)
  const media = await getMediaForPosts(
    tx,
    scope,
    posts.flatMap((p) => [
      ...p.mediaIds,
      ...(p.cover?.source === 'image' ? [p.cover.mediaId] : []),
    ]),
  )
  return posts.map((p) => toPostDto(p, media, { names }))
}

/** A post just written, read again in the same transaction. */
export async function readPost(
  tx: Tx,
  actor: OrgActor,
  scope: PostScope,
  postId: string,
): Promise<PostDto> {
  const post = await tx.posts.find(scope, postId)
  if (!post) throw postNotFound()
  const [dto] = await postDtos(tx, actor, scope, [post])
  if (!dto) throw postNotFound()
  return dto
}

export async function getPost(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
): Promise<PostDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: false })
      if (!isUuid(input.postId)) throw postNotFound()
      return readPost(tx, current, scope, input.postId)
    },
  )
}

const MAX_PAGE = 100

/** Newest first, by pages: `before` is the last post of the page before. */
export async function listPosts(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; status?: PostStatus; before?: string; limit?: number },
): Promise<{ items: PostDto[]; next: string | null }> {
  if (input.before !== undefined && !isUuid(input.before))
    throw new DomainError('VALIDATION', 'Pagina non valida', { field: 'before' })
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE)
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: false })
      // one more than asked tells whether a next page exists
      const page = await tx.posts.listByWorkspace(scope, {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.before === undefined ? {} : { before: input.before }),
        limit: limit + 1,
      })
      const items = page.slice(0, limit)
      return {
        items: await postDtos(tx, current, scope, items),
        next: page.length > limit ? (items.at(-1)?.id ?? null) : null,
      }
    },
  )
}
