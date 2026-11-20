import {
  DomainError,
  PROFILE_LINKS,
  can,
  type OrgActor,
  type Platform,
  type PostType,
  type PublishingPostStatus,
  type TargetStatus,
} from '@app/domain'
import { getAccountsForRules, getClientProfiles } from '../accounts/index.js'
import { isUuid } from '../identity/index.js'
import { getFailedMedia, getMediaForPosts, type PostMediaView } from '../media/index.js'
import type { Clock } from '../ports/clock.js'
import type { PostRecord } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { currentActor, workspaceNotFound } from '../workspaces/index.js'

// «Oggi» (redesign R3, screens 02 and 03): what goes out, what was left half done and what needs a
// hand, across the clients the person sees. A client that is hidden from the person is never
// read, so it is never counted either; an archived one is left out (its posts never go out).

/** The states the agenda shows: the posts that go out, are going out or went out (or not). */
const AGENDA_STATUSES: readonly PublishingPostStatus[] = [
  'scheduled',
  'publishing',
  'partial',
  'failed',
  'problem',
  'published',
  'paused',
]

/**
 * The posts of «Da sistemare» (plan 07 Scelta 8), the red ones first: not out, then paused or
 * with a problem. The destinations that need the hand are those in the post's own trouble.
 */
const POST_ISSUES = {
  failed: { rank: 0, target: 'failed' },
  partial: { rank: 0, target: 'failed' },
  paused: { rank: 1, target: 'paused' },
  problem: { rank: 1, target: 'problem' },
} as const satisfies Record<string, { rank: number; target: TargetStatus }>
type PostIssueStatus = keyof typeof POST_ISSUES
const isPostIssue = (status: string): status is PostIssueStatus =>
  Object.hasOwn(POST_ISSUES, status)
/** More posts than anyone fixes in a sitting: the rest waits for these. */
const POST_ISSUES_MAX = 50

/** The longest period one read covers: six weeks, a month as the calendar shows it. */
export const AGENDA_MAX_DAYS = 42
const DAY_MS = 24 * 60 * 60 * 1000
/** More posts than a person reads in one period: the rest stays out. */
const AGENDA_MAX_POSTS = 500
/** How much of the text a row shows. */
export const TEXT_START_LENGTH = 140

export const DRAFTS_DEFAULT = 3
export const DRAFTS_MAX = 20

/** The first copy the panel can show of a file, as the list of a client's posts picks it. */
export interface AgendaThumbnail {
  mediaId: string
  variant: 'thumbnail' | 'ig_feed'
}

export interface AgendaPostDto {
  id: string
  workspaceId: string
  type: PostType
  status: PublishingPostStatus
  scheduledAt: string
  timezone: string
  /** the start of the text, on one line; '' when there is none */
  text: string
  /** the platforms it goes to, each once */
  platforms: Platform[]
  mediaCount: number
  /** null for who does not use the client's library, the Viewer (D-72) */
  thumbnail: AgendaThumbnail | null
  /** its destinations that did not go out: «1 non uscito» */
  notOut: number
}

/** What a draft still needs before «Programma», read from its fields (not the checks). */
export type DraftMissing = 'media' | 'text' | 'accounts'

export interface DraftToFinishDto {
  id: string
  workspaceId: string
  type: PostType
  text: string
  missing: DraftMissing[]
  updatedAt: string
  thumbnail: AgendaThumbnail | null
}

export type AgendaIssueDto =
  | {
      kind: 'post'
      workspaceId: string
      postId: string
      type: PostType
      status: PostIssueStatus
      scheduledAt: string
      timezone: string
      /** the platforms of the destinations that need the hand, each once */
      platforms: Platform[]
      /** Feedway's code of the first of them: its error, or why it is `problem` */
      reason: string | null
      notOut: number
    }
  | {
      kind: 'profile'
      workspaceId: string
      profileKey: string
      /** the profile's name: its Facebook Page, or its only account */
      name: string
      platform: Platform
      /** what the link asks, as on the clients' page */
      link: 'reconnect' | 'error' | 'warning'
      /** scheduled posts from now that go to one of its accounts */
      scheduled: number
    }
  | {
      kind: 'media'
      workspaceId: string
      mediaId: string
      name: string
      failedAt: string
      retryable: boolean
    }

export interface ClientActivityDto {
  workspaceId: string
  /** scheduled posts from now */
  scheduled: number
  nextAt: string | null
  /** the latest change to one of its posts */
  changedAt: string
}

const notOutOf = (p: PostRecord) =>
  p.targets.filter((t) => (t.status as TargetStatus) === 'failed').length

/** Why a destination needs a hand, as a code: the reason of `problem`, else its last error. */
function reasonOf(target: {
  status: TargetStatus
  lastErrorCode: string | null
  verification: unknown
}) {
  if (
    target.status === 'problem' &&
    typeof target.verification === 'object' &&
    target.verification
  ) {
    const reason = (target.verification as { reason?: unknown }).reason
    if (typeof reason === 'string') return reason
  }
  return target.lastErrorCode
}

/** The text a row starts with: the common one, else a platform's, on one line. */
export function textStart(post: Pick<PostRecord, 'caption' | 'captionByPlatform'>): string {
  const text = [post.caption, post.captionByPlatform.instagram, post.captionByPlatform.facebook]
    .map((t) => (t ?? '').trim())
    .find((t) => t !== '')
  if (!text) return ''
  const line = text.replace(/\s+/g, ' ')
  // by code points, so an emoji at the edge is never cut in half
  const chars = Array.from(line)
  return chars.length > TEXT_START_LENGTH ? chars.slice(0, TEXT_START_LENGTH).join('') : line
}

/** What a draft lacks, in the order the editor asks it: files, text, accounts. */
export function draftMissing(
  post: Pick<PostRecord, 'mediaIds' | 'caption' | 'captionByPlatform' | 'targets'>,
): DraftMissing[] {
  const missing: DraftMissing[] = []
  if (post.mediaIds.length === 0) missing.push('media')
  if (textStart(post) === '') missing.push('text')
  if (post.targets.length === 0) missing.push('accounts')
  return missing
}

/** The period asked, or the next seven days from now; at most `AGENDA_MAX_DAYS`. */
export function agendaPeriod(now: Date, from?: string, to?: string): { from: Date; to: Date } {
  const start = from === undefined ? now : new Date(from)
  if (Number.isNaN(start.getTime()))
    throw new DomainError('VALIDATION', 'Periodo non valido', { field: 'from' })
  const end = to === undefined ? new Date(start.getTime() + 7 * DAY_MS) : new Date(to)
  if (Number.isNaN(end.getTime()) || end <= start)
    throw new DomainError('VALIDATION', 'Periodo non valido', { field: 'to' })
  if (end.getTime() - start.getTime() > AGENDA_MAX_DAYS * DAY_MS)
    throw new DomainError(
      'VALIDATION',
      `Il periodo è al massimo di ${String(AGENDA_MAX_DAYS)} giorni`,
      {
        field: 'to',
      },
    )
  return { from: start, to: end }
}

/**
 * The moment «from now» counts from: the panel's own, so a page and its counts agree on the day
 * (the browser may run ahead, as the fidelity shots do); the server's when left out.
 */
export function momentOf(clock: Clock, from?: string): Date {
  if (from === undefined) return clock.now()
  const at = new Date(from)
  if (Number.isNaN(at.getTime()))
    throw new DomainError('VALIDATION', 'Momento non valido', { field: 'from' })
  return at
}

/**
 * The clients the read covers: those the person sees and that are not archived, or the one asked
 * (not found when the person does not see it).
 */
async function clientsOf(tx: Tx, actor: OrgActor, workspaceId: string | undefined) {
  const current = await currentActor(tx, actor)
  const { organizationId } = current
  const visible = (await tx.workspaces.listVisible(current)).filter(
    (w) =>
      w.archivedAt === null &&
      can(current, 'workspace.view', { organizationId, workspaceId: w.id }),
  )
  if (workspaceId === undefined) return { current, ids: visible.map((w) => w.id) }
  const asked = isUuid(workspaceId) ? visible.find((w) => w.id === workspaceId) : undefined
  if (!asked) throw workspaceNotFound()
  return { current, ids: [asked.id] }
}

const thumbnailOf = (
  post: PostRecord,
  media: ReadonlyMap<string, PostMediaView>,
): AgendaThumbnail | null => {
  for (const id of post.mediaIds) {
    const file = media.get(id)
    if (!file || file.status === 'deleted') continue
    if (file.variants.includes('thumbnail')) return { mediaId: id, variant: 'thumbnail' }
    if (file.kind === 'image' && file.variants.includes('ig_feed'))
      return { mediaId: id, variant: 'ig_feed' }
    return null
  }
  return null
}

/**
 * The files and the accounts of the posts, read client by client as the posts module always reads
 * them. The files only where the person uses the library: the Viewer sees no thumbnail (D-72).
 */
async function detailsOf(tx: Tx, actor: OrgActor, records: readonly PostRecord[]) {
  const { organizationId } = actor
  const media = new Map<string, PostMediaView>()
  const platforms = new Map<string, Platform>()
  for (const workspaceId of new Set(records.map((p) => p.workspaceId))) {
    const scope = { organizationId, workspaceId }
    const own = records.filter((p) => p.workspaceId === workspaceId)
    if (can(actor, 'media.upload', scope))
      for (const [id, file] of await getMediaForPosts(
        tx,
        scope,
        own.flatMap((p) => p.mediaIds),
      ))
        media.set(id, file)
    for (const [id, account] of await getAccountsForRules(
      tx,
      scope,
      own.flatMap((p) => p.targets.map((t) => t.accountId)),
    ))
      platforms.set(id, account.platform)
  }
  return {
    thumbnail: (p: PostRecord) => thumbnailOf(p, media),
    /** each destination's account with its platform */
    accounts: (p: PostRecord): [string, Platform][] =>
      p.targets.flatMap((t) => {
        const platform = platforms.get(t.accountId)
        return platform ? [[t.accountId, platform] as [string, Platform]] : []
      }),
    platforms: (p: PostRecord) => [
      ...new Set(
        p.targets.flatMap((t) => {
          const platform = platforms.get(t.accountId)
          return platform ? [platform] : []
        }),
      ),
    ],
  }
}

/** The posts that go out in the period, by time (the strip and the list of «In uscita»). */
export async function listAgenda(
  deps: { uow: UnitOfWork; clock: Clock },
  actor: OrgActor,
  input: { from?: string; to?: string; workspaceId?: string },
): Promise<{ items: AgendaPostDto[] }> {
  const period = agendaPeriod(deps.clock.now(), input.from, input.to)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, ids } = await clientsOf(tx, actor, input.workspaceId)
    const records = await tx.posts.listInPeriod(organizationId, ids, {
      ...period,
      statuses: AGENDA_STATUSES,
      limit: AGENDA_MAX_POSTS,
    })
    const details = await detailsOf(tx, current, records)
    return {
      items: records.flatMap((p) =>
        p.scheduledAt === null
          ? []
          : [
              {
                id: p.id,
                workspaceId: p.workspaceId,
                type: p.type,
                status: p.status,
                scheduledAt: p.scheduledAt.toISOString(),
                timezone: p.timezone,
                text: textStart(p),
                platforms: details.platforms(p),
                mediaCount: p.mediaIds.length,
                thumbnail: details.thumbnail(p),
                notOut: notOutOf(p),
              },
            ],
      ),
    }
  })
}

/** «Bozze da finire»: the latest drafts with what each lacks, and how many there are. */
export async function listDraftsToFinish(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { limit?: number; workspaceId?: string },
): Promise<{ items: DraftToFinishDto[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? DRAFTS_DEFAULT, 1), DRAFTS_MAX)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, ids } = await clientsOf(tx, actor, input.workspaceId)
    const records = await tx.posts.listLatestDrafts(organizationId, ids, limit)
    const details = await detailsOf(tx, current, records)
    return {
      items: records.map((p) => ({
        id: p.id,
        workspaceId: p.workspaceId,
        type: p.type,
        text: textStart(p),
        missing: draftMissing(p),
        updatedAt: p.updatedAt.toISOString(),
        thumbnail: details.thumbnail(p),
      })),
      total: await tx.posts.countDrafts(organizationId, ids),
    }
  })
}

/**
 * «Da sistemare»: the posts that did not go out, then those paused or with a problem (plan 07
 * Scelta 8), the profiles whose link asks for a hand (worst first) and the files the worker could
 * not prepare (latest first). Every member of a client sees its posts: the Viewer opens the
 * outcome to read it.
 */
export async function listAgendaIssues(
  deps: { uow: UnitOfWork; clock: Clock },
  actor: OrgActor,
  input: { workspaceId?: string; from?: string },
): Promise<{ items: AgendaIssueDto[] }> {
  const { organizationId } = actor
  const now = momentOf(deps.clock, input.from)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, ids } = await clientsOf(tx, actor, input.workspaceId)
    const profiles = await getClientProfiles(tx, current)
    const asking = ids.flatMap((workspaceId) =>
      (profiles.get(workspaceId) ?? []).flatMap((p) =>
        p.link === 'ok' ? [] : [{ workspaceId, p, link: p.link }],
      ),
    )
    // the posts each profile holds up, read in one go for all of them
    const targets = await tx.posts.scheduledTargets(
      organizationId,
      ids,
      asking.flatMap(({ p }) => p.accounts.map((a) => a.id)),
      now,
    )
    const profileIssues: (AgendaIssueDto & { kind: 'profile' })[] = []
    for (const { workspaceId, p, link } of asking) {
      const named = p.accounts.find((a) => a.platform === 'facebook') ?? p.accounts[0]
      if (!named) continue
      const own = new Set(p.accounts.map((a) => a.id))
      profileIssues.push({
        kind: 'profile',
        workspaceId,
        profileKey: p.key,
        name: named.name,
        platform: named.platform,
        link,
        scheduled: new Set(
          targets
            .filter((t) => t.workspaceId === workspaceId && own.has(t.accountId))
            .map((t) => t.postId),
        ).size,
      })
    }
    profileIssues.sort((a, b) => PROFILE_LINKS.indexOf(a.link) - PROFILE_LINKS.indexOf(b.link))
    const postIssues = await postIssuesOf(tx, current, ids)
    const files = await getFailedMedia(tx, current, ids)
    return {
      items: [
        ...postIssues,
        ...profileIssues,
        ...files.map((f) => ({
          kind: 'media' as const,
          workspaceId: f.workspaceId,
          mediaId: f.id,
          name: f.originalName,
          failedAt: f.failedAt.toISOString(),
          retryable: f.retryable,
        })),
      ],
    }
  })
}

/** The posts of «Da sistemare», with the platforms and the reason of what needs the hand. */
async function postIssuesOf(
  tx: Tx,
  actor: OrgActor,
  workspaceIds: readonly string[],
): Promise<(AgendaIssueDto & { kind: 'post' })[]> {
  const { organizationId } = actor
  const records = (
    await tx.posts.listWithStatuses(
      organizationId,
      workspaceIds,
      Object.keys(POST_ISSUES) as PostIssueStatus[],
      POST_ISSUES_MAX,
    )
  ).filter((p) => p.scheduledAt !== null)
  const targets = await tx.publishing.targetsOfPosts(
    organizationId,
    records.map((p) => p.id),
  )
  const details = await detailsOf(tx, actor, records)
  const platformOf = new Map(records.flatMap((p) => details.accounts(p)))
  return records
    .flatMap((p) => {
      const status = p.status as string
      if (!isPostIssue(status) || p.scheduledAt === null) return []
      const trouble = targets.filter(
        (t) => t.postId === p.id && t.status === POST_ISSUES[status].target,
      )
      const first = trouble[0]
      return [
        {
          kind: 'post' as const,
          workspaceId: p.workspaceId,
          postId: p.id,
          type: p.type,
          status,
          scheduledAt: p.scheduledAt.toISOString(),
          timezone: p.timezone,
          platforms: [
            ...new Set(
              trouble.flatMap((t) => {
                const platform = platformOf.get(t.accountId)
                return platform ? [platform] : []
              }),
            ),
          ],
          reason: first ? reasonOf(first) : null,
          notOut: notOutOf(p),
        },
      ]
    })
    .sort((a, b) => POST_ISSUES[a.status].rank - POST_ISSUES[b.status].rank)
}

/**
 * For each client the person sees that has a post: how many go out from now, the next one, and
 * when its posts last changed («Clienti recenti», and the clients' page of R4).
 */
export async function listClientActivity(
  deps: { uow: UnitOfWork; clock: Clock },
  actor: OrgActor,
  input: { from?: string } = {},
): Promise<{ items: ClientActivityDto[] }> {
  const { organizationId } = actor
  const now = momentOf(deps.clock, input.from)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { ids } = await clientsOf(tx, actor, undefined)
    const rows = await tx.posts.activityOf(organizationId, ids, now)
    return {
      items: rows
        .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
        .map((r) => ({
          workspaceId: r.workspaceId,
          scheduled: r.scheduled,
          nextAt: r.nextAt?.toISOString() ?? null,
          changedAt: r.changedAt.toISOString(),
        })),
    }
  })
}
