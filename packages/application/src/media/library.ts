import {
  DomainError,
  VARIANT_PURPOSES,
  can,
  displayName,
  deletionBlock,
  postCount,
  primaryUse,
  type DeletionBlock,
  type MediaChecks,
  type MediaFailure,
  type MediaKind,
  type MediaProgress,
  type MediaStatus,
  type MediaUse,
  type OrgActor,
  type PostStatus,
  type VariantPurpose,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { MediaFilter, MediaRecord, MediaVariantRecord } from '../ports/media.js'
import type { Storage, StoredObject, StoredRange } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { assertActiveOrganization, currentActor, workspaceNotFound } from '../workspaces/index.js'

// The files of a workspace (spec §11.1, §11.8; plan 04 Task 8). Using the library takes
// `media.upload`, Editor and above (§10.2): for a Viewer, as for someone without a role in the
// workspace, the library does not exist (404).

export interface MediaVariantDto {
  purpose: VariantPurpose
  mime: string
  sizeBytes: number
  width: number | null
  height: number | null
}

/** What the panel sees of a file: never its storage keys nor a public token. */
export interface MediaDto {
  id: string
  kind: MediaKind
  status: MediaStatus
  originalName: string
  mime: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  progress: MediaProgress | null
  failure: MediaFailure | null
  checks: MediaChecks | null
  uploadedBy: string
  /** «Caricato oggi alle 10:14, da Marco Bassi» (screen 20); empty for a person gone */
  uploadedByName: string
  workspaceId: string
  createdAt: string
  folderId: string | null
  tags: string[]
  variants: MediaVariantDto[]
  /** the post that uses the file and counts (`primaryUse`, D-80.7): «Nel post di …» */
  usedIn: {
    postId: string
    status: PostStatus
    scheduledAt: string | null
    timezone: string
    /** how many posts use the file */
    count: number
  } | null
  /** why the file is not deleted (`deletionBlock`, D-80.4): what the deletion answers 409 by */
  deleteBlockedBy: {
    reason: DeletionBlock['reason']
    postId: string
    scheduledAt: string | null
    timezone: string
    count: number
  } | null
}

/** The posts that use each file, all of them: the rules of the domain pick from them. */
export async function usesOf(
  tx: Tx,
  organizationId: string,
  mediaIds: readonly string[],
): Promise<Map<string, MediaUse[]>> {
  const uses = new Map<string, MediaUse[]>()
  for (const use of await tx.posts.usingMedia(organizationId, mediaIds)) {
    const list = uses.get(use.mediaId) ?? []
    list.push(use)
    uses.set(use.mediaId, list)
  }
  return uses
}

const iso = (at: Date | null) => (at === null ? null : at.toISOString())

/** Who uploaded each file, by name: people of the agency, or who were. */
async function uploaderNames(tx: Tx, records: readonly MediaRecord[]) {
  const ids = [...new Set(records.map((r) => r.uploadedBy))]
  if (ids.length === 0) return new Map<string, string>()
  return new Map((await tx.users.summaries(ids)).map((u) => [u.id, displayName(u)]))
}

/** The panel's view of these files: copies, uses and who uploaded them, read once for all. */
async function mediaDtos(tx: Tx, organizationId: string, records: readonly MediaRecord[]) {
  const ids = records.map((m) => m.id)
  const variants = await tx.media.variantsOf(organizationId, ids)
  const uses = await usesOf(tx, organizationId, ids)
  const names = await uploaderNames(tx, records)
  return records.map((m) => toDto(m, variants, uses, names))
}

export const mediaNotFound = () => new DomainError('NOT_FOUND', 'File non trovato')

const MAX_PAGE = 100

export function toDto(
  record: MediaRecord,
  variants: readonly MediaVariantRecord[],
  uses: ReadonlyMap<string, readonly MediaUse[]>,
  names: ReadonlyMap<string, string> = new Map(),
): MediaDto {
  const all = uses.get(record.id) ?? []
  const use = primaryUse(all)
  const block = deletionBlock(all)
  return {
    usedIn: use
      ? {
          postId: use.postId,
          status: use.status,
          scheduledAt: iso(use.scheduledAt),
          timezone: use.timezone,
          count: postCount(all),
        }
      : null,
    deleteBlockedBy: block && { ...block, scheduledAt: iso(block.scheduledAt) },
    id: record.id,
    kind: record.kind,
    status: record.status,
    originalName: record.originalName,
    mime: record.mime,
    sizeBytes: record.sizeBytes,
    width: record.width,
    height: record.height,
    durationMs: record.durationMs,
    fps: record.fps,
    videoCodec: record.videoCodec,
    audioCodec: record.audioCodec,
    progress: record.progress,
    failure: record.failure,
    checks: record.checks,
    uploadedBy: record.uploadedBy,
    uploadedByName: names.get(record.uploadedBy) ?? '',
    workspaceId: record.workspaceId,
    createdAt: record.createdAt.toISOString(),
    folderId: record.folderId,
    tags: record.tags,
    variants: variants
      .filter((v) => v.mediaId === record.id)
      .map((v) => ({
        purpose: v.purpose,
        mime: v.mime,
        sizeBytes: v.sizeBytes,
        width: v.width,
        height: v.height,
      })),
  }
}

/**
 * The workspace's library, for an actor who may use it, read again in the transaction. Anyone
 * else, the Viewer included, finds no workspace.
 */
export async function openLibrary(tx: Tx, actor: OrgActor, workspaceId: string) {
  if (!isUuid(workspaceId)) throw workspaceNotFound()
  const current = await currentActor(tx, actor)
  const workspace = await tx.workspaces.findVisibleById(current, workspaceId)
  if (
    !workspace ||
    !can(current, 'media.upload', { organizationId: actor.organizationId, workspaceId })
  )
    throw workspaceNotFound()
  return { current, workspace }
}

/** A file of the workspace not deleted, or NOT_FOUND. */
export async function liveMedia(
  tx: Tx,
  organizationId: string,
  workspaceId: string,
  mediaId: string,
) {
  if (!isUuid(mediaId)) throw mediaNotFound()
  const found = await tx.media.findById(organizationId, mediaId)
  if (found?.workspaceId !== workspaceId || found.status === 'deleted') throw mediaNotFound()
  return found
}

export interface MediaListFilter {
  kind?: 'image' | 'video'
  /** a folder's id, or `none` for the files in no folder */
  folder?: string
  tag?: string
  /** a part of the file's name */
  name?: string
  /** only the files a post uses */
  inPosts?: boolean
  /** by the use that counts (screen 19) */
  use?: 'any' | 'scheduled' | 'draft' | 'unused'
}

export async function listMedia(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; before?: string; limit?: number; filter?: MediaListFilter },
): Promise<{ items: MediaDto[]; next: string | null; usedBytes: number; tags: string[] }> {
  const { organizationId } = actor
  if (input.before !== undefined && !isUuid(input.before))
    throw new DomainError('VALIDATION', 'Pagina non valida', { field: 'before' })
  const filter = cleanFilter(input.filter)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    // one more than asked tells whether a next page exists
    const page = await tx.media.listForWorkspace(organizationId, workspace.id, {
      ...(input.before === undefined ? {} : { before: input.before }),
      limit: limit + 1,
      filter,
    })
    const items = page.slice(0, limit)
    const used = await tx.media.storageUsed(organizationId, workspace.id)
    return {
      items: await mediaDtos(tx, organizationId, items),
      next: page.length > limit ? (items.at(-1)?.id ?? null) : null,
      usedBytes: used.workspace,
      tags: await tx.media.tagsOf(organizationId, workspace.id),
    }
  })
}

/** The filter as the repository takes it: a folder that is not an id finds nothing. */
function cleanFilter(filter: MediaListFilter | undefined): MediaFilter {
  if (!filter) return {}
  const name = filter.name?.trim()
  const tag = filter.tag?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('it')
  if (filter.folder !== undefined && filter.folder !== 'none' && !isUuid(filter.folder))
    throw new DomainError('VALIDATION', 'Cartella non valida', { field: 'folder' })
  return {
    ...(filter.kind === undefined ? {} : { kind: filter.kind }),
    ...(filter.folder === undefined ? {} : { folder: filter.folder }),
    ...(tag ? { tag } : {}),
    ...(name ? { name } : {}),
    ...(filter.inPosts ? { inPosts: true } : {}),
    ...(filter.use === undefined ? {} : { use: filter.use }),
  }
}

export async function getMedia(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; mediaId: string },
): Promise<MediaDto> {
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    const found = await liveMedia(tx, organizationId, workspace.id, input.mediaId)
    return mediaDto(tx, organizationId, found)
  })
}

/** One file as the panel sees it, with its copies and the post that uses it. */
export async function mediaDto(tx: Tx, organizationId: string, record: MediaRecord) {
  const [dto] = await mediaDtos(tx, organizationId, [record])
  if (!dto) throw mediaNotFound()
  return dto
}

/**
 * «Libreria» with «Tutti i clienti» (screen 19, Matteo 20/11): the files of every active client
 * whose library the person uses (Editor and above), newest first, with how many photos and videos
 * the filter finds. Narrowed to one client, a client the person does not use the library of is
 * NOT_FOUND, as in the client's own library. Folders stay in the client's library.
 */
export async function listAgencyMedia(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: {
    workspaceId?: string
    before?: string
    limit?: number
    filter?: Omit<MediaListFilter, 'folder'>
  },
): Promise<{ items: MediaDto[]; next: string | null; counts: Record<MediaKind, number> }> {
  const { organizationId } = actor
  if (input.before !== undefined && !isUuid(input.before))
    throw new DomainError('VALIDATION', 'Pagina non valida', { field: 'before' })
  const filter = cleanFilter(input.filter)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    const usable = (await tx.workspaces.listVisible(current))
      .filter(
        (w) =>
          w.archivedAt === null &&
          can(current, 'media.upload', { organizationId, workspaceId: w.id }),
      )
      .map((w) => w.id)
    let ids = usable
    if (input.workspaceId !== undefined) {
      const asked = input.workspaceId
      if (!isUuid(asked) || !usable.includes(asked)) throw workspaceNotFound()
      ids = [asked]
    }
    const page = await tx.media.listForWorkspaces(organizationId, ids, {
      ...(input.before === undefined ? {} : { before: input.before }),
      limit: limit + 1,
      filter,
    })
    const items = page.slice(0, limit)
    return {
      items: await mediaDtos(tx, organizationId, items),
      next: page.length > limit ? (items.at(-1)?.id ?? null) : null,
      counts: await tx.media.countByKind(organizationId, ids, filter),
    }
  })
}

export interface DeleteMediaDeps {
  uow: UnitOfWork
  clock: Clock
  queue: Pick<JobQueue, 'send'>
  logger: Logger
}

/**
 * Deletes a file from the panel (§11.9): the row is marked `deleted` and leaves the library at
 * once, and `media.delete_files` removes its files and copies after the commit.
 */
export async function deleteMedia(
  deps: DeleteMediaDeps,
  actor: OrgActor,
  input: { workspaceId: string; mediaId: string },
  request: { ip: string | null },
): Promise<void> {
  const { organizationId } = actor
  const mediaId = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, workspace } = await openLibrary(tx, actor, input.workspaceId)
    await assertActiveOrganization(tx, organizationId)
    if (workspace.archivedAt !== null)
      throw new DomainError('CONFLICT', 'Il cliente è archiviato: i suoi file non si modificano')
    const found = await liveMedia(tx, organizationId, workspace.id, input.mediaId)
    // the same lock as scheduling: a post is not scheduled with a file deleted meanwhile
    await tx.posts.lockSchedule(organizationId)
    // the rule the file's DTO shows (D-80.4): the panel says it before anyone tries
    const block = deletionBlock(await tx.posts.usingMedia(organizationId, [found.id]))
    if (block)
      throw new DomainError(
        'CONFLICT',
        `Questo file è nel post programmato del ${dayOf(block.scheduledAt, block.timezone)}: toglilo dal post o annulla il post prima di eliminarlo`,
        { reason: 'media_in_scheduled_post' },
      )
    if (!(await tx.media.markDeleted(organizationId, workspace.id, found.id, deps.clock.now())))
      throw mediaNotFound()
    // no file name: it can be a person's
    await tx.audit.record({
      organizationId,
      actorId: current.userId,
      source: 'panel',
      action: 'media.deleted',
      entity: 'media',
      entityId: found.id,
      workspaceId: workspace.id,
      ip: request.ip,
    })
    return found.id
  })
  try {
    await deps.queue.send('media.delete_files', { organizationId, mediaId })
  } catch (error) {
    // the file is gone from the panel; its bytes wait for the clean-up of plan 04 Task 9
    deps.logger.error({ err: error, mediaId }, 'media files deletion not queued')
  }
}

/** The day of a post for a message, in the post's time zone. */
function dayOf(at: Date | null, timeZone: string): string {
  if (at === null) return '—'
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'numeric',
    timeZone,
  }).format(at)
}

/**
 * «Riprova» (D-39): a file `failed` whose original was kept (`timeout`, `processing_failed`:
 * the fault may be the machine's) is `processing` again and the worker is woken. Any other file
 * is a CONFLICT: a final refusal has no original left, and is uploaded again.
 */
export async function retryMedia(
  deps: DeleteMediaDeps,
  actor: OrgActor,
  input: { workspaceId: string; mediaId: string },
  request: { ip: string | null },
): Promise<MediaDto> {
  const { organizationId } = actor
  const mediaId = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, workspace } = await openLibrary(tx, actor, input.workspaceId)
    await assertActiveOrganization(tx, organizationId)
    if (workspace.archivedAt !== null)
      throw new DomainError('CONFLICT', 'Il cliente è archiviato: i suoi file non si modificano')
    const found = await liveMedia(tx, organizationId, workspace.id, input.mediaId)
    if (!(await tx.media.markRetried(organizationId, found.id)))
      throw new DomainError(
        'CONFLICT',
        'Questo file non si può preparare di nuovo: caricalo un’altra volta',
      )
    await tx.audit.record({
      organizationId,
      actorId: current.userId,
      source: 'panel',
      action: 'media.retried',
      entity: 'media',
      entityId: found.id,
      workspaceId: workspace.id,
      ip: request.ip,
    })
    return found.id
  })
  try {
    await deps.queue.send('media.process', { organizationId, mediaId })
  } catch (error) {
    // the file waits as `processing`: the clean-up wakes the worker for it
    deps.logger.error({ err: error, mediaId }, 'media processing not queued')
  }
  return getMedia(deps, actor, { workspaceId: input.workspaceId, mediaId })
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` of HTTP `Range`, already parsed. */
export type ByteRange = { start: number; end: number | null } | { suffix: number }

export type MediaFile = { etag: string; contentType: string } & (
  { kind: 'whole'; object: StoredObject } | { kind: 'part'; object: StoredRange }
)

/** The only types the panel serves: what the worker writes, never a page or a script. */
const SERVED_TYPES = ['image/jpeg', 'image/webp', 'video/mp4']

const isPurpose = (value: string): value is VariantPurpose =>
  (VARIANT_PURPOSES as readonly string[]).includes(value)

/**
 * A copy of a file for the panel, the `preview` included, whole or a byte range of it (the
 * video player asks for ranges). The original is never served: a photo's may hold the GPS
 * until its copy is ready (§15.7). null: no such copy, as for any file the actor cannot see.
 */
export async function readMediaFile(
  deps: { uow: UnitOfWork; storage: Storage },
  actor: OrgActor,
  input: { workspaceId: string; mediaId: string; variant: string; range: ByteRange | null },
): Promise<MediaFile | null> {
  const { organizationId } = actor
  if (!isPurpose(input.variant)) return null
  const purpose = input.variant
  const variant = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    if (!isUuid(input.mediaId)) return null
    const found = await tx.media.findById(organizationId, input.mediaId)
    if (found?.workspaceId !== workspace.id || found.status === 'deleted') return null
    const variants = await tx.media.variantsOf(organizationId, [found.id])
    return variants.find((v) => v.purpose === purpose) ?? null
  })
  if (!variant || !SERVED_TYPES.includes(variant.mime)) return null
  return readCopy(deps.storage, variant, input.range)
}

/** A stored copy, whole or the byte range asked; null when its file is gone from the storage. */
export async function readCopy(
  storage: Storage,
  variant: { id: string; storageKey: string; mime: string; sizeBytes: number },
  range: ByteRange | null,
): Promise<MediaFile | null> {
  const head = { etag: variant.id, contentType: variant.mime }
  if (range === null) {
    const object = await storage.get(variant.storageKey)
    return object && { ...head, kind: 'whole', object }
  }
  // a suffix counts from the size the database knows; the answer carries the stored one
  const start = 'suffix' in range ? Math.max(variant.sizeBytes - range.suffix, 0) : range.start
  const end = 'suffix' in range || range.end === null ? Number.MAX_SAFE_INTEGER : range.end
  const object = await storage.getRange(variant.storageKey, start, end)
  return object && { ...head, kind: 'part', object }
}
