import type {
  MediaUse,
  Post,
  PostCover,
  PostStatus,
  PostType,
  PublishingHistoryFacts,
  PublishingPostStatus,
} from '@app/domain'

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
  /** cancelled by a person on the page of the outcome: a save of the post leaves it out */
  cancelledInPanel: boolean
}

/** A post with its files (in order), its cover, its destinations and its labels. */
export interface PostRecord extends Post {
  /** in «Eliminati» since (plan 09 Scelta 12); null: not there */
  trashedAt: Date | null
  /** who sent it there; null: the night's clean-up */
  trashedBy: string | null
  mediaIds: string[]
  cover: PostCover | null
  targets: PostTargetRecord[]
  labelIds: string[]
}

/** What a new post stores; it starts as a draft, at version 1. No id: the repository gives one. */
export type NewPost = { id?: string } & Pick<
  Post,
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
  /** when the worker looks at it first: `prepareAt` for a scheduled one, null otherwise */
  nextAttemptAt?: Date | null
  /** when it is checked again, 3 hours before (Scelta 4); null otherwise */
  recheckAt?: Date | null
}

/** An internal note on a post (§11.7): never shown outside the agency. */
export interface PostNoteRecord {
  id: string
  postId: string
  authorId: string
  body: string
  createdAt: Date
}

/**
 * What the calendar asks of the posts (plan 09 Task 2), every filter in SQL so the limit cuts
 * only what the filters keep. An empty list of a filter means any.
 */
export interface CalendarPostQuery {
  /**
   * a time in `[from, to)`, by time; `undated`: the drafts without one, latest changed first;
   * `trashed`: the posts in «Eliminati», dated or not, the latest sent there first. Every other
   * period leaves «Eliminati» out.
   */
  period: { from: Date; to: Date } | 'undated' | 'trashed'
  statuses: readonly PublishingPostStatus[]
  types: readonly PostType[]
  /** who created it */
  authorIds: readonly string[]
  /** a destination to one of them */
  accountIds: readonly string[]
  /** one of these labels */
  labelIds: readonly string[]
  /**
   * only drafts with no file, no account, no internal note and a text of blanks only: the
   * candidates of «Elimina le bozze vuote», chosen in the query so the limit counts only them
   */
  emptyOnly?: boolean
  limit: number
}

export interface PostRepository {
  /** The new post's id. */
  insert(post: NewPost): Promise<string>
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
  /** The posts of the workspace not in «Eliminati», newest first; `before`: the posts after this one. */
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
  /**
   * The destinations as given; an account already there keeps its row (and its id). A row
   * kept starts its round of the worker again (plan 07 P2): a new generation, no step, no
   * attempt or error, its `nextAttemptAt`; the ids of what was prepared on Meta stay under
   * `DISCARD_KEY` of `meta_ids`, for the next preparation to throw away. Only for destinations
   * the panel may move (`canMoveTarget(..., 'panel')`).
   */
  replaceTargets(scope: PostScope, postId: string, targets: readonly NewPostTarget[]): Promise<void>
  replaceLabels(scope: PostScope, postId: string, labelIds: readonly string[]): Promise<void>
  /** false: no such post. */
  delete(scope: PostScope, postId: string): Promise<boolean>
  /**
   * Into «Eliminati» (`trashed` given) or back out of it (null), the version up by one; false:
   * no such post, or already there (or not there).
   */
  setTrashed(
    scope: PostScope,
    postId: string,
    trashed: { at: Date; by: string | null } | null,
    updatedBy: string | null,
  ): Promise<boolean>
  /**
   * What the night's clean-up of the agency looks at (plan 09 Task 14), clients not archived
   * only, at most `limit` of each: the posts in «Eliminati» since before `trashedBefore`, the
   * empty drafts not touched since `emptyBefore`, and the drafts not touched for the days their
   * client chose, as of `now`.
   */
  cleanupCandidates(
    organizationId: string,
    query: { now: Date; trashedBefore: Date; emptyBefore: Date; limit: number },
  ): Promise<{
    expired: { id: string; workspaceId: string }[]
    empty: { id: string; workspaceId: string }[]
    stale: { id: string; workspaceId: string }[]
  }>
  /**
   * Every scheduled post of the workspace back to draft, with its destinations and without
   * their fingerprints (D-70: archiving a client); the ids of the posts moved.
   */
  unscheduleAll(scope: PostScope, updatedBy: string): Promise<string[]>
  /**
   * Takes the agency's scheduling lock until the transaction ends: scheduling, the posts of a
   * day and the deletion of a file of a scheduled post go one at a time.
   */
  lockSchedule(organizationId: string): Promise<void>
  /** The scheduled posts of the agency in `[from, to)`, but `excludePostId` (`posts_per_day`). */
  countScheduled(
    organizationId: string,
    range: { from: Date; to: Date },
    excludePostId?: string,
  ): Promise<number>
  /** The state of each post of the agency found, in one query (plan 06, for stage 9). */
  statuses(organizationId: string, postIds: readonly string[]): Promise<Map<string, PostStatus>>
  /** What `PublishingHistory` answers, read from the scheduled destinations. */
  publishingFacts(query: PublishingHistoryQuery): Promise<PublishingHistoryFacts>
  /**
   * The posts of the agency, not deleted, that use the file (as a file or as a cover), each post
   * once per file, those in «Eliminati» too (`trashed`), in the order of `compareUses` (D-80.7): `primaryUse` and `deletionBlock`
   * decide what the library says and whether a file is deleted (D-18).
   */
  usingMedia(
    organizationId: string,
    mediaIds: readonly string[],
  ): Promise<(MediaUse & { mediaId: string })[]>
  /**
   * The posts of these workspaces with one of these states and a time in `[from, to)`, by time
   * (the agenda of «Oggi», redesign R3); at most `limit`.
   */
  listInPeriod(
    organizationId: string,
    workspaceIds: readonly string[],
    period: { from: Date; to: Date; statuses: readonly PublishingPostStatus[]; limit: number },
  ): Promise<PostRecord[]>
  /**
   * The posts of these workspaces in one of these states, the latest time first, at most
   * `limit`: the posts of «Da sistemare» (plan 07 Scelta 8).
   */
  listWithStatuses(
    organizationId: string,
    workspaceIds: readonly string[],
    statuses: readonly PublishingPostStatus[],
    limit: number,
  ): Promise<PostRecord[]>
  /** The posts of these workspaces for the calendar and its list (plan 09 Task 2). */
  listForCalendar(
    organizationId: string,
    workspaceIds: readonly string[],
    query: CalendarPostQuery,
  ): Promise<PostRecord[]>
  /** The drafts of these workspaces, the latest changed first; at most `limit`. */
  listLatestDrafts(
    organizationId: string,
    workspaceIds: readonly string[],
    limit: number,
  ): Promise<PostRecord[]>
  countDrafts(organizationId: string, workspaceIds: readonly string[]): Promise<number>
  /**
   * For each of these workspaces that has a post: its scheduled posts from `from`, the first of
   * them, and the latest change to any of its posts.
   */
  activityOf(
    organizationId: string,
    workspaceIds: readonly string[],
    from: Date,
  ): Promise<{ workspaceId: string; scheduled: number; nextAt: Date | null; changedAt: Date }[]>
  /**
   * The destinations among these accounts of the scheduled posts of these workspaces from
   * `from`, in one query: the posts each profile of «Da sistemare» holds up.
   */
  scheduledTargets(
    organizationId: string,
    workspaceIds: readonly string[],
    accountIds: readonly string[],
    from: Date,
  ): Promise<{ postId: string; workspaceId: string; accountId: string }[]>
  /** The notes of a post, oldest first. */
  listNotes(scope: PostScope, postId: string): Promise<PostNoteRecord[]>
  insertNote(
    scope: PostScope,
    note: { id: string; postId: string; authorId: string; body: string },
  ): Promise<PostNoteRecord>
  findNote(scope: PostScope, postId: string, noteId: string): Promise<PostNoteRecord | null>
  deleteNote(scope: PostScope, postId: string, noteId: string): Promise<boolean>
}
