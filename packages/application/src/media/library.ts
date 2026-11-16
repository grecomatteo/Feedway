import {
  DomainError,
  VARIANT_PURPOSES,
  can,
  type MediaChecks,
  type MediaFailure,
  type MediaKind,
  type MediaProgress,
  type MediaStatus,
  type OrgActor,
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
  createdAt: string
  folderId: string | null
  tags: string[]
  variants: MediaVariantDto[]
}

export const mediaNotFound = () => new DomainError('NOT_FOUND', 'File non trovato')

const MAX_PAGE = 100

export function toDto(record: MediaRecord, variants: readonly MediaVariantRecord[]): MediaDto {
  return {
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
    const variants = await tx.media.variantsOf(
      organizationId,
      items.map((m) => m.id),
    )
    const used = await tx.media.storageUsed(organizationId, workspace.id)
    return {
      items: items.map((m) => toDto(m, variants)),
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
    return toDto(found, await tx.media.variantsOf(organizationId, [found.id]))
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
