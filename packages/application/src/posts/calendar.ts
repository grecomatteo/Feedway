import {
  GRID_POST_TYPES,
  autoTrashAt,
  can,
  instantToZoned,
  isGridPost,
  isGridWaiting,
  type LocalDate,
  type OrgActor,
  type Platform,
  type PostType,
  type PublishingPostStatus,
} from '@app/domain'
import { getAccountPlatforms } from '../accounts/index.js'
import type { PostRecord } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import {
  detailsOf,
  draftMissing,
  notOutOf,
  textStart,
  type AgendaThumbnail,
  type DraftMissing,
} from './agenda.js'
import { openPosts, mayEditContent, recordPost } from './common.js'

// The posts of the calendar and of its list (spec §11.4, plan 09 Task 2), for the `calendar`
// module: every filter in SQL, the rows as the panel draws them, the days in the agency's zone.

/** The filters of the posts; an empty list means any. */
export interface PostRangeFilters {
  statuses: readonly PublishingPostStatus[]
  types: readonly PostType[]
  authorIds: readonly string[]
  accountIds: readonly string[]
  platforms: readonly Platform[]
  labelIds: readonly string[]
}

export interface CalendarPostDto {
  id: string
  workspaceId: string
  type: PostType
  status: PublishingPostStatus
  /** null: a draft without a date */
  scheduledAt: string | null
  /** IANA, the post's own (D-58) */
  timezone: string
  /** the day and time in the agency's zone, where the calendar puts it; null without a date */
  localDate: LocalDate | null
  localTime: string | null
  text: string
  firstFile: string | null
  mediaCount: number
  /** null for the Viewer (D-72) */
  thumbnail: AgendaThumbnail | null
  /** each destination's account and platform; one cancelled on its own is left out */
  accounts: { id: string; platform: Platform }[]
  labelIds: string[]
  createdBy: string
  /** what it lacks before «Programma», read from its fields */
  missing: DraftMissing[]
  /** a draft without text, files, accounts or date: «Elimina le bozze vuote» takes it */
  empty: boolean
  notOut: number
  /** to move it with the version read (plan 09 P7) */
  version: number
  updatedAt: string
  /** in «Eliminati» since (plan 09 Scelta 12); null: not there */
  trashedAt: string | null
  /**
   * a draft nobody touches goes to «Eliminati» then, by the days its client chose; null: never
   * («Mai»), or not a draft. The list warns of it from 7 days before.
   */
  autoTrashAt: string | null
}

/** A draft that holds nothing: no text, no file, no account and no date (plan 09 Scelta 12). */
export const isEmptyDraft = (p: PostRecord) =>
  p.status === 'draft' &&
  p.scheduledAt === null &&
  p.mediaIds.length === 0 &&
  p.targets.length === 0 &&
  textStart(p) === ''

/**
 * The posts of these clients (all visible to `actor`, already checked) in the period, or the
 * drafts without a date, at most `limit` and whether there were more. Public, for `calendar`.
 */
export async function listPostsInRange(
  tx: Tx,
  actor: OrgActor,
  input: {
    workspaceIds: readonly string[]
    period: { from: Date; to: Date } | 'undated' | 'trashed'
    timeZone: string
    filters: PostRangeFilters
    limit: number
  },
): Promise<{ items: CalendarPostDto[]; truncated: boolean }> {
  const { organizationId } = actor
  const { filters, workspaceIds } = input
  let accountIds = [...filters.accountIds]
  if (filters.platforms.length > 0) {
    const platforms = await getAccountPlatforms(tx, organizationId, workspaceIds)
    const ofPlatform = [...platforms].filter(([, p]) => filters.platforms.includes(p))
    const wanted = new Set(accountIds)
    accountIds = ofPlatform.map(([id]) => id).filter((id) => wanted.size === 0 || wanted.has(id))
    // no account of that platform: no post either (an empty list would mean any)
    if (accountIds.length === 0) return { items: [], truncated: false }
  }
  const records = await tx.posts.listForCalendar(organizationId, workspaceIds, {
    period: input.period,
    statuses: filters.statuses,
    types: filters.types,
    authorIds: filters.authorIds,
    accountIds,
    labelIds: filters.labelIds,
    limit: input.limit + 1,
  })
  const truncated = records.length > input.limit
  const kept = truncated ? records.slice(0, input.limit) : records
  return { truncated, items: await calendarPostsOf(tx, actor, kept, input.timeZone) }
}

/** The rows of these posts as the calendar draws them, the days in `timeZone`. */
async function calendarPostsOf(
  tx: Tx,
  actor: OrgActor,
  records: readonly PostRecord[],
  timeZone: string,
): Promise<CalendarPostDto[]> {
  const details = await detailsOf(tx, actor, records)
  const retention = new Map(
    records.length === 0
      ? []
      : (await tx.workspaces.listVisible(actor)).map((w) => [w.id, w.draftRetentionDays]),
  )
  return records.map((p) => {
    const autoTrash =
      p.status === 'draft' && p.trashedAt === null
        ? autoTrashAt(p.updatedAt, retention.get(p.workspaceId) ?? null)
        : null
    const local = p.scheduledAt ? instantToZoned(p.scheduledAt, timeZone) : null
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      type: p.type,
      status: p.status,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      timezone: p.timezone,
      localDate: local?.localDate ?? null,
      localTime: local?.localTime ?? null,
      text: textStart(p),
      firstFile: details.firstFile(p),
      mediaCount: p.mediaIds.length,
      thumbnail: details.thumbnail(p),
      accounts: details.accounts(p).map(([id, platform]) => ({ id, platform })),
      labelIds: [...p.labelIds],
      createdBy: p.createdBy,
      missing: draftMissing(p),
      empty: isEmptyDraft(p),
      notOut: notOutOf(p),
      version: p.version,
      updatedAt: p.updatedAt.toISOString(),
      trashedAt: p.trashedAt?.toISOString() ?? null,
      autoTrashAt: autoTrash?.toISOString() ?? null,
    }
  })
}

/** More than a client schedules on one profile in a month: the rest is left out. */
export const GRID_POSTS_MAX = 200

/**
 * The scheduled posts of Instagram's grid (plan 09 Task 12): those of the client that go out on
 * this account in the period, still waiting there (not out, not cancelled), and that reach the
 * feed (no story, no reel kept among the reels). Latest first, as the grid shows them. The
 * client is visible to `actor`, already checked. Public, for `calendar`.
 */
/** How far back a post on its way (retrying, paused) is still looked for. */
const GRID_LATE_MS = 86_400_000

export async function listGridPosts(
  tx: Tx,
  actor: OrgActor,
  input: {
    workspaceId: string
    accountId: string
    /** from now on; a post already on its way whose time is gone stays (up to a day back) */
    period: { from: Date; to: Date }
    timeZone: string
  },
): Promise<CalendarPostDto[]> {
  const { from, to } = input.period
  const records = await tx.posts.listForCalendar(actor.organizationId, [input.workspaceId], {
    period: { from: new Date(from.getTime() - GRID_LATE_MS), to },
    statuses: ['scheduled', 'publishing'],
    types: GRID_POST_TYPES,
    authorIds: [],
    accountIds: [input.accountId],
    labelIds: [],
    limit: GRID_POSTS_MAX,
  })
  const waiting = records.filter((p) => {
    const mine = p.targets.find((t) => t.accountId === input.accountId)
    if (!mine || !isGridWaiting(mine.status)) return false
    // its time gone, only while it is on its way (being prepared, retried or paused)
    const ahead = p.scheduledAt !== null && p.scheduledAt >= from
    return (
      (ahead || mine.status !== 'scheduled') &&
      isGridPost({ type: p.type, shareToFeed: p.options.shareToFeed })
    )
  })
  const latestFirst = [...waiting].sort(
    (a, b) => (b.scheduledAt?.getTime() ?? 0) - (a.scheduledAt?.getTime() ?? 0),
  )
  return calendarPostsOf(tx, actor, latestFirst, input.timeZone)
}

/** More empty drafts than anyone leaves: the rest goes with the next press. */
export const EMPTY_DRAFTS_MAX = 500

/**
 * «Elimina le bozze vuote» (plan 09 Scelta 2): the empty drafts of these clients (visible to
 * `actor`, not archived), one's own, or everyone's with `all` where the person has
 * `post.manage_others`. Each is locked and read again before it goes, so a draft that got a
 * text in between stays. Public, for `calendar`.
 */
export async function deleteEmptyDrafts(
  tx: Tx,
  actor: OrgActor,
  input: { workspaceIds: readonly string[]; all: boolean; ip: string | null },
): Promise<{ deleted: number }> {
  const { organizationId } = actor
  const candidates = (
    await tx.posts.listForCalendar(organizationId, input.workspaceIds, {
      period: 'undated',
      statuses: ['draft'],
      types: [],
      authorIds: input.all ? [] : [actor.userId],
      accountIds: [],
      labelIds: [],
      emptyOnly: true,
      limit: EMPTY_DRAFTS_MAX,
    })
  ).filter(isEmptyDraft)
  let deleted = 0
  for (const workspaceId of new Set(candidates.map((p) => p.workspaceId))) {
    // the same doors as «Elimina»: an active agency, a client not archived, a lock on it
    const { current, scope } = await openPosts(tx, actor, workspaceId, { write: true })
    for (const candidate of candidates.filter((p) => p.workspaceId === workspaceId)) {
      if (deleted >= EMPTY_DRAFTS_MAX) return { deleted }
      const own = candidate.createdBy === current.userId
      const resource = { ...scope, ownerId: candidate.createdBy }
      const allowed = own
        ? can(current, 'post.draft', resource)
        : input.all && can(current, 'post.manage_others', resource)
      if (!allowed) continue
      const post = await tx.posts.findForUpdate(scope, candidate.id)
      if (!post || post.trashedAt !== null || !isEmptyDraft(post) || !mayEditContent(current, post))
        continue
      if (!(await tx.posts.delete(scope, post.id))) continue
      await recordPost(tx, current, 'post.deleted', post, input.ip)
      deleted++
    }
  }
  return { deleted }
}
