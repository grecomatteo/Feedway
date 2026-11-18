import type { Post, PostCover, PostStatus, PublishingHistoryFacts } from '@app/domain'

// The posts of a workspace (spec §13, plan 06 Task 3). Every method takes the agency and the
// workspace, and filters by them in SQL as well: row level security is the second barrier. The
// use case checks first that the actor sees the workspace.

/** What the checks ask of the history (`PublishingHistory`, plan 06 Task 3). */
export interface PublishingHistoryQuery {
  organizationId: string
  accountIds: readonly string[]
  at: Date
  /** the post being checked: never a duplicate of itself */
  excludePostId?: string
}

export interface PostScope {
  organizationId: string
  workspaceId: string
}

/** A destination of the post: one account, its state and, once scheduled, its fingerprint. */
export interface PostTargetRecord {
  id: string
  accountId: string
  status: PostStatus
  /** hex sha256 of `postFingerprint` after the choices (P3); null until scheduled */
  fingerprint: string | null
}

/** A post with its files (in order), its cover, its destinations and its labels. */
export interface PostRecord extends Post {
  mediaIds: string[]
  cover: PostCover | null
  targets: PostTargetRecord[]
  labelIds: string[]
}

/** What a new post stores; it starts as a draft, at version 1. */
export type NewPost = Pick<
  Post,
  | 'id'
  | 'organizationId'
  | 'workspaceId'
  | 'type'
  | 'caption'
  | 'captionByPlatform'
  | 'scheduledAt'
  | 'timezone'
  | 'options'
  | 'createdBy'
>

/** The fields a save writes; the version goes up by one. */
export type PostChange = Pick<
  Post,
  | 'type'
  | 'caption'
  | 'captionByPlatform'
  | 'scheduledAt'
  | 'status'
  | 'options'
  | 'scheduledBy'
  | 'updatedBy'
>

export interface NewPostTarget {
  accountId: string
  status: PostStatus
  fingerprint: string | null
}

export interface PostRepository {
  insert(post: NewPost): Promise<void>
  find(scope: PostScope, postId: string): Promise<PostRecord | null>
  /** Same, and locks the post until the transaction ends: its writes go one at a time. */
  findForUpdate(scope: PostScope, postId: string): Promise<PostRecord | null>
  /**
   * Writes the change if the post is still at `expectedVersion` (§11.9) and returns the new
   * version; null: someone saved it in between, or it is gone.
   */
  update(
    scope: PostScope,
    postId: string,
    change: PostChange,
    expectedVersion: number,
  ): Promise<number | null>
  /** The posts of the workspace, newest first; `before`: the posts after this one. */
  listByWorkspace(
    scope: PostScope,
    page: { status?: PostStatus; before?: string; limit: number },
  ): Promise<PostRecord[]>
  /** The files in order; the cover sits on the first one (a reel has one file). */
  replaceMedia(
    scope: PostScope,
    postId: string,
    mediaIds: readonly string[],
    cover: PostCover | null,
  ): Promise<void>
  /** The destinations as given; an account already there keeps its row (and its id). */
  replaceTargets(scope: PostScope, postId: string, targets: readonly NewPostTarget[]): Promise<void>
  replaceLabels(scope: PostScope, postId: string, labelIds: readonly string[]): Promise<void>
  /** false: no such post. */
  delete(scope: PostScope, postId: string): Promise<boolean>
  /** The state of each post of the agency found, in one query (plan 06, for stage 9). */
  statuses(organizationId: string, postIds: readonly string[]): Promise<Map<string, PostStatus>>
  /** What `PublishingHistory` answers, read from the scheduled destinations. */
  publishingFacts(query: PublishingHistoryQuery): Promise<PublishingHistoryFacts>
  /**
   * The posts of the agency, not deleted, that use the file (as a file or as a cover), the
   * scheduled ones first: a file of a scheduled post is not deleted (D-18).
   */
  usingMedia(
    organizationId: string,
    mediaIds: readonly string[],
  ): Promise<{ mediaId: string; postId: string; status: PostStatus; scheduledAt: Date | null }[]>
}
