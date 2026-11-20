import {
  DomainError,
  can,
  instantToZoned,
  zonedToInstant,
  type OrgActor,
  type Platform,
  type PlatformRules,
  type PostCaption,
  type PostCover,
  type PostStatus,
  type PostType,
  type RuleChoice,
} from '@app/domain'
import { getAccountsForRules } from '../accounts/index.js'
import { isUuid } from '../identity/index.js'
import { getMediaForPosts } from '../media/index.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { PostChange, PostRecord, PostScope } from '../ports/posts.js'
import type { PublishingHistory } from '../ports/publishing-history.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { assertActiveOrganization, currentActor, workspaceNotFound } from '../workspaces/index.js'

// What the use cases of the posts share: who sees the workspace, who may touch a post, the
// content as the editor sends it.

export const postNotFound = () => new DomainError('NOT_FOUND', 'Post non trovato')

/** §11.9: someone saved the post between the read and this write. */
export const versionConflict = () =>
  new DomainError(
    'CONFLICT',
    'Il post è stato modificato da un’altra persona: ricarica per vedere la versione nuova',
    { reason: 'post_version_conflict' },
  )

export const cannotEdit = () =>
  new DomainError('FORBIDDEN', 'Questo post è di un’altra persona: non puoi modificarlo')

/** «Programma» of a draft: the draft itself stays as it was saved. */
export const cannotSchedule = () =>
  new DomainError(
    'FORBIDDEN',
    'Non puoi programmare post in questo cliente: la bozza resta salvata per chi può farlo',
  )

/** A scheduled post: changing it, back to draft, cancelling. */
export const cannotChangeScheduled = () =>
  new DomainError(
    'FORBIDDEN',
    'Non puoi modificare un post programmato: chiedi a chi può programmare in questo cliente',
  )

/** The local day and time of the post, in its time zone; null: no date yet. */
export type PostWhenInput = { localDate: string; localTime: string } | null

/** What the editor saves (spec §11.2). */
export interface PostContent {
  type: PostType
  mediaIds: readonly string[]
  cover: PostCover | null
  caption: PostCaption
  destinations: readonly { accountId: string }[]
  when: PostWhenInput
  shareToFeed: boolean
  choices: readonly RuleChoice[]
}

/**
 * The workspace of the request, for a member who sees it (`workspace.view`, the Viewer
 * included), read again in the transaction. A write also needs the agency active and the
 * client not archived.
 */
export async function openPosts(
  tx: Tx,
  actor: OrgActor,
  workspaceId: string,
  opts: { write: boolean },
) {
  if (!isUuid(workspaceId)) throw workspaceNotFound()
  const { organizationId } = actor
  const current = await currentActor(tx, actor)
  const workspace = await tx.workspaces.findVisibleById(current, workspaceId)
  if (!workspace || !can(current, 'workspace.view', { organizationId, workspaceId }))
    throw workspaceNotFound()
  const scope: PostScope = { organizationId, workspaceId: workspace.id }
  if (!opts.write) return { current, workspace, scope, organization: null }
  const organization = await assertActiveOrganization(tx, organizationId)
  // a write waits for an archiving under way, and archiving waits for the writes: a post is
  // never scheduled in a client that was just archived (D-70, its scheduled posts go back to
  // draft in the same transaction)
  const locked = await tx.workspaces.findForShare(organizationId, workspace.id)
  if (!locked || locked.archivedAt !== null)
    throw new DomainError('CONFLICT', 'Il cliente è archiviato: i suoi post non si modificano')
  return { current, workspace, scope, organization }
}

/** The post, locked until the transaction ends: its writes go one at a time. */
export async function lockedPost(tx: Tx, scope: PostScope, postId: string): Promise<PostRecord> {
  if (!isUuid(postId)) throw postNotFound()
  const post = await tx.posts.findForUpdate(scope, postId)
  if (!post) throw postNotFound()
  return post
}

const resourceOf = (post: PostRecord) => ({
  organizationId: post.organizationId,
  workspaceId: post.workspaceId,
  ownerId: post.createdBy,
})

/** Its own draft (`post.draft`), or anyone's (`post.manage_others`, Manager and above). */
export const mayEditContent = (actor: OrgActor, post: PostRecord) =>
  can(actor, 'post.draft', resourceOf(post)) || can(actor, 'post.manage_others', resourceOf(post))

/** Schedule, back to draft, cancel: the Publisher on every post (`post.publish`). */
export const mayPublish = (actor: OrgActor, post: PostRecord) =>
  can(actor, 'post.publish', resourceOf(post))

/** A move the post's state does not allow (§9.3, P7). */
export function wrongState(
  status: PostStatus,
  action: 'schedule' | 'edit' | 'unschedule' | 'cancel' | 'delete',
) {
  const messages: Record<typeof action, Partial<Record<PostStatus, string>>> = {
    schedule: {
      scheduled: 'Il post è già programmato',
      cancelled: 'Il post è annullato: non si programma di nuovo',
    },
    edit: { cancelled: 'Il post è annullato: non si modifica' },
    unschedule: {
      draft: 'Il post è già una bozza',
      cancelled: 'Il post è annullato: non torna in bozza',
    },
    cancel: {
      draft: 'Una bozza non si annulla: eliminala',
      cancelled: 'Il post è già annullato',
    },
    delete: {
      scheduled: 'Un post programmato non si elimina: riportalo in bozza o annullalo prima',
    },
  }
  return new DomainError(
    'CONFLICT',
    messages[action][status] ?? 'Il post non si può modificare così',
  )
}

/** The instant of the post's day and time in its time zone; an impossible date is refused. */
export function scheduledAtOf(when: PostWhenInput, timeZone: string): Date | null {
  if (when === null) return null
  let resolved: ReturnType<typeof zonedToInstant>
  try {
    resolved = zonedToInstant(when.localDate, when.localTime, timeZone)
  } catch (error) {
    if (error instanceof DomainError && error.code === 'VALIDATION')
      throw new DomainError('VALIDATION', 'Questa data non esiste nel calendario', {
        field: 'when',
      })
    throw error
  }
  // an hour the clock change skips moves forward (D-49 a): the editor's checks said so
  return resolved.instant
}

/**
 * Every file and account of the content must be the workspace's (Review Focus 5): an id of
 * another workspace or agency is «non trovato», as an id that is no one's. A file deleted from
 * the library stays a file of the workspace, so a draft that holds it saves again; an account
 * taken off the client stays acceptable for the post that already had it.
 */
export async function assertReferences(
  tx: Tx,
  scope: PostScope,
  content: PostContent,
  current: PostRecord | null,
): Promise<void> {
  const coverId = content.cover?.source === 'image' ? content.cover.mediaId : null
  const mediaIds = [...content.mediaIds, ...(coverId === null ? [] : [coverId])]
  const media = await getMediaForPosts(tx, scope, mediaIds)
  if (mediaIds.some((id) => !media.has(id))) throw new DomainError('NOT_FOUND', 'File non trovato')
  const kept = new Set(current?.targets.map((t) => t.accountId) ?? [])
  const wanted = content.destinations.map((d) => d.accountId).filter((id) => !kept.has(id))
  const accounts = await getAccountsForRules(tx, scope, wanted)
  if (wanted.some((id) => !accounts.has(id)))
    throw new DomainError('NOT_FOUND', 'Account non trovato')
}

/** The content of a saved post, to merge a save that changes only some fields. */
export function contentOf(post: PostRecord, when: PostWhenInput): PostContent {
  return {
    type: post.type,
    mediaIds: post.mediaIds,
    cover: post.cover,
    caption: { common: post.caption, ...post.captionByPlatform },
    destinations: post.targets.map((t) => ({ accountId: t.accountId })),
    when,
    shareToFeed: post.options.shareToFeed,
    choices: post.options.choices,
  }
}

/** The text of each platform that has its own; the common one goes in `caption`. */
export function captionByPlatformOf(caption: PostCaption): PostRecord['captionByPlatform'] {
  return {
    ...(caption.instagram === undefined ? {} : { instagram: caption.instagram }),
    ...(caption.facebook === undefined ? {} : { facebook: caption.facebook }),
  }
}

/** The files and destinations of the content, each destination in the given state. */
export async function writeParts(
  tx: Tx,
  scope: PostScope,
  postId: string,
  content: PostContent,
  status: PostStatus,
): Promise<void> {
  // the cover sits on the first file: with no file there is nowhere to keep it
  await tx.posts.replaceMedia(scope, postId, content.mediaIds, content.cover)
  await tx.posts.replaceTargets(
    scope,
    postId,
    content.destinations.map((d) => ({ accountId: d.accountId, status, fingerprint: null })),
  )
}

export async function recordPost(
  tx: Tx,
  actor: OrgActor,
  action:
    | 'post.created'
    | 'post.updated'
    | 'post.scheduled'
    | 'post.unscheduled'
    | 'post.cancelled'
    | 'post.deleted',
  post: { id: string; workspaceId: string; scheduledAt?: Date | null },
  ip: string | null,
) {
  // nothing of the text: it can name people. A post scheduled says for when, so the log reads
  // «ha programmato un post per ven 20 nov, 8:00» (screen 26)
  await tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'post',
    entityId: post.id,
    workspaceId: post.workspaceId,
    ip,
    ...(action === 'post.scheduled' && post.scheduledAt
      ? { data: { scheduledAt: post.scheduledAt.toISOString() } }
      : {}),
  })
}

export interface PostsDeps {
  uow: UnitOfWork
  clock: Clock
  /** The publishing's jobs, sent after the commit (plan 07 P3), and the copies' wake-up. */
  queue: Pick<JobQueue, 'send'>
  logger: Logger
  /** The copies to publish asked for at the scheduling (Scelta 4). */
  ids: IdGenerator
  newPublicToken: () => string
  /** from the composition root (ADR 019): the checks of a scheduled post */
  platformRules: ReadonlyMap<Platform, PlatformRules>
  publishingHistory: PublishingHistory
}

/** A save: the version read, and the fields that change. */
export type UpdatePostInput = { workspaceId: string; version: number } & Partial<PostContent> & {
    /** the labels of the post, all of them (§11.7) */
    labelIds?: readonly string[]
  }

/**
 * The labels given, each once, all of the workspace: a label of another workspace or agency is
 * «non trovata» (Review Focus 5).
 */
export async function writeLabels(
  tx: Tx,
  scope: PostScope,
  postId: string,
  labelIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(labelIds)]
  const found = await tx.contentSettings.existingLabels(scope, wanted.filter(isUuid))
  if (wanted.some((id) => !found.has(id)))
    throw new DomainError('NOT_FOUND', 'Etichetta non trovata')
  await tx.posts.replaceLabels(scope, postId, wanted)
}

const whenOf = (post: PostRecord): PostWhenInput => {
  if (post.scheduledAt === null) return null
  const { localDate, localTime } = instantToZoned(post.scheduledAt, post.timezone)
  return { localDate, localTime }
}

/** The saved content with the fields of the save over it: a field left out stays. */
export function mergeContent(post: PostRecord, input: UpdatePostInput): PostContent {
  const saved = contentOf(post, whenOf(post))
  return {
    type: input.type ?? saved.type,
    mediaIds: input.mediaIds ?? saved.mediaIds,
    cover: input.cover === undefined ? saved.cover : input.cover,
    caption: input.caption ?? saved.caption,
    destinations: input.destinations ?? saved.destinations,
    when: input.when === undefined ? saved.when : input.when,
    shareToFeed: input.shareToFeed ?? saved.shareToFeed,
    choices: input.choices ?? saved.choices,
  }
}

/** The fields of the post row a save writes. */
export function changeOf(
  post: PostRecord,
  content: PostContent,
  by: string,
  status: PostStatus,
): PostChange {
  return {
    type: content.type,
    caption: content.caption.common,
    captionByPlatform: captionByPlatformOf(content.caption),
    scheduledAt: scheduledAtOf(content.when, post.timezone),
    status,
    options: { shareToFeed: content.shareToFeed, choices: [...content.choices] },
    scheduledBy: post.scheduledBy,
    updatedBy: by,
  }
}

/** The destinations the panel may still move (plan 07 P2): none is being published. */
const IN_PANEL_REACH = new Set<string>(['scheduled', 'preparing', 'ready', 'retrying', 'cancelled'])

/**
 * A post the panel changes as a scheduled one: scheduled, or in preparation with no destination
 * publishing or out yet (P2). Its state in the database may be one of the publishing.
 */
export async function isScheduledForPanel(tx: Tx, post: PostRecord): Promise<boolean> {
  const status: string = post.status
  if (status === 'scheduled') return true
  if (status !== 'publishing') return false
  const targets = await tx.publishing.targetsOfPost(post.organizationId, post.id)
  return targets.every((t) => IN_PANEL_REACH.has(t.status))
}
