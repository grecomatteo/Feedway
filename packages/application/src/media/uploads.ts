import {
  DomainError,
  SNIFF_BYTES,
  UPLOAD_PART_BYTES,
  UPLOAD_TTL_MS,
  checkStorage,
  declaredKind,
  isSha256Hex,
  isUploadDeclaredType,
  mediaPrefix,
  mediaVariantKey,
  missingUploadParts,
  parseLimits,
  sha256OfContentDigest,
  sniffMedia,
  uploadPartCount,
  uploadPartSize,
  type OrgActor,
  type SniffedMedia,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { RateLimiter } from '../ports/rate-limiter.js'
import type { Storage } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { UploadParts, UploadSessionRecord } from '../ports/uploads.js'
import { assertActiveOrganization } from '../workspaces/index.js'
import { getMedia, openLibrary, type MediaDto } from './library.js'

// The upload in pieces (RF-30, ADR 021, plan 04 Task 9): a session per file and person, pieces
// of 20 MiB with their sha256 on the web's disk, then one stream into the storage. Only the
// person who started an upload sees it: for anyone else, as for another agency, it does not
// exist (404).

export interface UploadDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  storage: Storage
  uploadParts: UploadParts
  queue: Pick<JobQueue, 'send'>
  logger: Logger
  rateLimiter: RateLimiter
  limits: {
    /** MEDIA_MAX_VIDEO_BYTES: the highest limit, the only one checked before the bytes */
    maxVideoBytes: number
    /** MEDIA_WORKSPACE_MAX_BYTES; null: none */
    workspaceMaxBytes: number | null
  }
}

/** What the panel needs to send the pieces, or to resume them after a fall or a reload. */
export interface UploadDto {
  id: string
  name: string
  type: string
  sizeBytes: number
  folderId: string | null
  firstPartSha256: string
  partBytes: number
  partCount: number
  /** the pieces the server has, in order */
  received: number[]
  expiresAt: string
  /** the file it became, once complete */
  mediaId: string | null
}

/**
 * Every call that writes, per person and per agency: an upload of 300 MB is 15 pieces, so
 * these leave room for many files while a stolen session cannot keep the disk busy.
 */
export const UPLOAD_RATE_LIMITS = {
  person: { limit: 600, windowMs: 10 * 60_000 },
  agency: { limit: 3000, windowMs: 10 * 60_000 },
} as const

const uploadNotFound = () => new DomainError('NOT_FOUND', 'Caricamento non trovato')

function toDto(record: UploadSessionRecord): UploadDto {
  return {
    id: record.id,
    name: record.originalName,
    type: record.mime,
    sizeBytes: record.sizeBytes,
    folderId: record.folderId,
    firstPartSha256: record.firstPartSha256,
    partBytes: UPLOAD_PART_BYTES,
    partCount: uploadPartCount(record.sizeBytes),
    received: Object.keys(record.parts)
      .map(Number)
      .sort((a, b) => a - b),
    expiresAt: record.expiresAt.toISOString(),
    mediaId: record.mediaId,
  }
}

async function limitUploads(deps: Pick<UploadDeps, 'rateLimiter'>, actor: OrgActor) {
  const { person, agency } = UPLOAD_RATE_LIMITS
  for (const [key, rule] of [
    [`uploads:user:${actor.userId}`, person],
    [`uploads:org:${actor.organizationId}`, agency],
  ] as const) {
    const hit = await deps.rateLimiter.hit(key, rule.limit, rule.windowMs)
    if (!hit.allowed)
      throw new DomainError('RATE_LIMITED', 'Troppi caricamenti. Riprova tra qualche minuto.', {
        retryAfterSeconds: Math.max(1, Math.ceil(hit.retryAfterMs / 1000)),
      })
  }
}

/**
 * Control, zero-width and direction characters: invisible, they could make a name look like
 * another one (`fattura<U+202E>gpj.exe` reads `fatturaexe.jpg`).
 */
// eslint-disable-next-line no-control-regex -- removing them is the point
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g

/** The name as shown, without invisible characters. */
export function displayName(name: string): string {
  const clean = name.replace(INVISIBLE, '').trim()
  if (clean.length === 0 || clean.length > 255)
    throw new DomainError('VALIDATION', 'Nome del file non valido', { field: 'name' })
  return clean
}

/** A workspace whose files may change: the agency active, the workspace not archived. */
async function assertWritable(tx: Tx, organizationId: string, archivedAt: Date | null) {
  await assertActiveOrganization(tx, organizationId)
  if (archivedAt !== null)
    throw new DomainError('CONFLICT', 'Il cliente è archiviato: i suoi file non si modificano')
}

/**
 * The caller's own upload in the workspace, completed or open; an expired one that is not
 * complete is gone already for the person, even before the clean-up removes it.
 */
async function ownUpload(
  tx: Tx,
  actor: OrgActor,
  workspaceId: string,
  uploadId: string,
  now: Date,
  opts: { forUpdate?: boolean } = {},
) {
  if (!isUuid(uploadId)) throw uploadNotFound()
  const found = await tx.uploads.findById(actor.organizationId, uploadId, opts)
  if (
    found?.workspaceId !== workspaceId ||
    found.userId !== actor.userId ||
    (found.completedAt === null && found.expiresAt <= now)
  )
    throw uploadNotFound()
  return found
}

export interface StartUploadInput {
  workspaceId: string
  name: string
  type: string
  sizeBytes: number
  firstPartSha256: string
  folderId?: string | null
}

/**
 * Starts an upload: the declared type and size are checked, and the space is reserved at once,
 * one creation of the agency at a time, against `storage_bytes` and the workspace's limit. What
 * the uploads not yet complete reserve counts as used.
 */
export async function startUpload(
  deps: UploadDeps,
  actor: OrgActor,
  input: StartUploadInput,
): Promise<UploadDto> {
  await limitUploads(deps, actor)
  const { organizationId } = actor
  const name = displayName(input.name)
  if (!isUploadDeclaredType(input.type))
    throw new DomainError('UNSUPPORTED_FILE_TYPE', 'Si caricano solo foto e video', {
      field: 'type',
    })
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1)
    throw new DomainError('VALIDATION', 'Dimensione non valida', { field: 'sizeBytes' })
  if (input.sizeBytes > deps.limits.maxVideoBytes)
    throw new DomainError(
      'FILE_TOO_LARGE',
      `Il file può pesare al massimo ${String(Math.floor(deps.limits.maxVideoBytes / 1_000_000))} MB`,
      { limit: deps.limits.maxVideoBytes },
    )
  if (!isSha256Hex(input.firstPartSha256))
    throw new DomainError('VALIDATION', 'Impronta del primo pezzo non valida', {
      field: 'firstPartSha256',
    })
  const folderId = input.folderId ?? null
  if (folderId !== null && !isUuid(folderId))
    throw new DomainError('VALIDATION', 'Cartella non trovata', { field: 'folderId' })
  const now = deps.clock.now()
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    await assertWritable(tx, organizationId, workspace.archivedAt)
    if (folderId !== null && !(await tx.media.folderExists(organizationId, workspace.id, folderId)))
      throw new DomainError('VALIDATION', 'Cartella non trovata', { field: 'folderId' })
    await tx.uploads.lockReservations(organizationId)
    const organization = await assertActiveOrganization(tx, organizationId)
    const used = await tx.media.storageUsed(organizationId, workspace.id)
    const reserved = await tx.uploads.reservedBytes(organizationId, workspace.id, now)
    const check = checkStorage(
      {
        limits: parseLimits(organization.limits),
        workspaceMaxBytes: deps.limits.workspaceMaxBytes,
      },
      {
        organization: used.organization + reserved.organization,
        workspace: used.workspace + reserved.workspace,
      },
      input.sizeBytes,
    )
    if (!check.ok)
      throw new DomainError(
        'LIMIT_REACHED',
        check.scope === 'organization'
          ? 'L’agenzia ha finito lo spazio per i file'
          : 'Il cliente ha finito lo spazio per i file',
        { scope: check.scope, limit: check.limit },
      )
    const created = await tx.uploads.create({
      id: deps.ids.newId(),
      organizationId,
      workspaceId: workspace.id,
      userId: actor.userId,
      folderId,
      originalName: name,
      mime: input.type,
      sizeBytes: input.sizeBytes,
      firstPartSha256: input.firstPartSha256,
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
    })
    return toDto(created)
  })
}

/** The caller's uploads of the workspace left halfway: to resume them after a reload. */
export async function listUploads(
  deps: Pick<UploadDeps, 'uow' | 'clock'>,
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<UploadDto[]> {
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    const open = await tx.uploads.listOpen(
      organizationId,
      workspace.id,
      actor.userId,
      deps.clock.now(),
    )
    return open.map(toDto)
  })
}

/** Which pieces the server has: after a fall the browser sends only the others. */
export async function getUpload(
  deps: Pick<UploadDeps, 'uow' | 'clock'>,
  actor: OrgActor,
  input: { workspaceId: string; uploadId: string },
): Promise<UploadDto> {
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    return toDto(await ownUpload(tx, actor, workspace.id, input.uploadId, deps.clock.now()))
  })
}

/** The pieces' folder went while a piece was arriving: the upload was cancelled meanwhile. */
function cancelledMeanwhile(error: unknown): never {
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') throw uploadNotFound()
  throw error
}

export interface UploadPartInput {
  workspaceId: string
  uploadId: string
  n: number
  /** the request's `Content-Digest` (RFC 9530), as sent */
  contentDigest: string | null
  /** the request's `Content-Length`; null: sent in chunks */
  contentLength: number | null
  body: AsyncIterable<Uint8Array>
}

/**
 * Receives piece `n`, written as it arrives and kept only if its size and sha256 are the
 * declared ones. The same piece again with the same sha256 changes nothing and is not read; with
 * another sha256 it is a CONFLICT. A piece longer than it should be is refused as soon as that
 * shows, without reading the rest.
 */
export async function receiveUploadPart(
  deps: UploadDeps,
  actor: OrgActor,
  input: UploadPartInput,
): Promise<UploadDto> {
  await limitUploads(deps, actor)
  const { organizationId } = actor
  const scope = { organizationId, userId: actor.userId }
  const session = await deps.uow.run(scope, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    await assertWritable(tx, organizationId, workspace.archivedAt)
    return ownUpload(tx, actor, workspace.id, input.uploadId, deps.clock.now())
  })
  if (session.completedAt !== null)
    throw new DomainError('CONFLICT', 'Il caricamento è già completato')
  const expected = uploadPartSize(session.sizeBytes, input.n)
  if (expected === null)
    throw new DomainError('VALIDATION', 'Questo pezzo non fa parte del file', { field: 'n' })
  const tooLarge = () =>
    new DomainError('FILE_TOO_LARGE', 'Il pezzo è più grande del previsto', { limit: expected })
  if (input.contentLength !== null && input.contentLength > expected) throw tooLarge()
  if (input.contentLength !== null && input.contentLength < expected)
    throw new DomainError('VALIDATION', 'Il pezzo è incompleto', { field: 'body' })
  const digest = sha256OfContentDigest(input.contentDigest)
  if (digest === null)
    throw new DomainError('VALIDATION', 'Manca l’impronta sha-256 del pezzo (Content-Digest)', {
      field: 'Content-Digest',
    })
  const already = session.parts[String(input.n)]
  if (already === digest) return toDto(session)
  if (already !== undefined)
    throw new DomainError('CONFLICT', 'Questo pezzo è già arrivato con un contenuto diverso')
  if (input.n === 1 && digest !== session.firstPartSha256)
    throw new DomainError('VALIDATION', 'Questo non è il primo pezzo del file dichiarato', {
      field: 'Content-Digest',
    })

  const received = await deps.uploadParts
    .receive(organizationId, session.id, input.body, expected)
    .catch(cancelledMeanwhile)
  if (received === 'too_large') throw tooLarge()
  try {
    if (received.size !== expected)
      throw new DomainError('VALIDATION', 'Il pezzo è incompleto', { field: 'body' })
    if (received.sha256 !== digest)
      throw new DomainError(
        'VALIDATION',
        'Il pezzo è arrivato diverso da come è partito: rimandalo',
        {
          field: 'Content-Digest',
        },
      )
    return await deps.uow.run(scope, async (tx) => {
      // one piece at a time per upload: two tabs sending the same piece meet here
      const locked = await tx.uploads.findById(organizationId, session.id, { forUpdate: true })
      if (!locked) throw uploadNotFound()
      if (locked.completedAt !== null)
        throw new DomainError('CONFLICT', 'Il caricamento è già completato')
      const current = locked.parts[String(input.n)]
      if (current !== undefined && current !== digest)
        throw new DomainError('CONFLICT', 'Questo pezzo è già arrivato con un contenuto diverso')
      if (current === undefined) {
        await deps.uploadParts
          .keep(organizationId, session.id, input.n, received.pending)
          .catch(cancelledMeanwhile)
        await tx.uploads.recordPart(organizationId, session.id, input.n, digest)
      }
      return toDto({ ...locked, parts: { ...locked.parts, [String(input.n)]: digest } })
    })
  } finally {
    // nothing left once the piece was kept: it no longer has its pending name
    await deps.uploadParts.discard(organizationId, session.id, received.pending)
  }
}

/** How long a completion keeps the upload for itself: enough to join 300 MB to the storage. */
export const UPLOAD_COMPLETION_HOLD_MS = 30 * 60 * 1000

/**
 * Joins the pieces into one stream to the storage, with the sha256 of the whole file, and makes
 * the file: `processing` in the library, with a wake-up for the worker (`media.process`). A
 * file whose first bytes are no type Feedway takes is `failed` at once and nothing is stored.
 * Idempotent: a second call answers with the same file; one arriving while the pieces are
 * being joined is a CONFLICT to retry, so the file is never copied twice at once.
 */
export async function completeUpload(
  deps: UploadDeps,
  actor: OrgActor,
  input: { workspaceId: string; uploadId: string },
): Promise<MediaDto> {
  await limitUploads(deps, actor)
  const { organizationId } = actor
  const scope = { organizationId, userId: actor.userId }
  const media = (mediaId: string) =>
    getMedia(deps, actor, { workspaceId: input.workspaceId, mediaId })
  const session = await deps.uow.run(scope, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    const now = deps.clock.now()
    const found = await ownUpload(tx, actor, workspace.id, input.uploadId, now, {
      forUpdate: true,
    })
    if (found.mediaId !== null) return found
    await assertWritable(tx, organizationId, workspace.archivedAt)
    const missing = missingUploadParts(found.sizeBytes, Object.keys(found.parts).map(Number))
    if (missing.length > 0)
      throw new DomainError('CONFLICT', 'Mancano dei pezzi del file', { missing })
    const until = new Date(now.getTime() + UPLOAD_COMPLETION_HOLD_MS)
    if (!(await tx.uploads.claimCompletion(organizationId, found.id, now, until)))
      throw new DomainError('CONFLICT', 'Il file si sta già completando: riprova tra poco')
    return found
  })
  if (session.mediaId !== null) return media(session.mediaId)

  const mediaId = deps.ids.newId()
  let stored: { key: string; sha256: string } | null = null
  const forget = async () => {
    if (stored) await deps.storage.deletePrefix(mediaPrefix(organizationId, mediaId))
  }
  let sniffed: SniffedMedia | null
  let winner: { id: string; created: boolean }
  try {
    sniffed = sniffMedia(await deps.uploadParts.head(organizationId, session.id, SNIFF_BYTES))
    if (sniffed) {
      const key = mediaVariantKey(organizationId, mediaId, 'original', sniffed.extension)
      const assembled = deps.uploadParts.assemble(
        organizationId,
        session.id,
        uploadPartCount(session.sizeBytes),
      )
      const { size } = await deps.storage.put(key, assembled.body, { contentType: sniffed.mime })
      stored = { key, sha256: assembled.sha256() }
      if (size !== session.sizeBytes)
        throw new Error('the pieces of an upload do not add up to its size')
    }
    const found = sniffed
    winner = await deps.uow.run(scope, async (tx) => {
      // access again: the person, the agency or the workspace may have changed meanwhile
      const { workspace } = await openLibrary(tx, actor, input.workspaceId)
      await assertWritable(tx, organizationId, workspace.archivedAt)
      // the file takes the space its upload reserved: no creation reads the two in between
      await tx.uploads.lockReservations(organizationId)
      const locked = await tx.uploads.findById(organizationId, session.id, { forUpdate: true })
      const now = deps.clock.now()
      if (locked?.userId !== actor.userId || locked.workspaceId !== workspace.id)
        throw uploadNotFound()
      // a completion whose hold ran out made the file first: that file is the one
      if (locked.mediaId !== null) return { id: locked.mediaId, created: false }
      if (locked.expiresAt <= now) throw uploadNotFound()
      await tx.media.create({
        id: mediaId,
        organizationId,
        workspaceId: locked.workspaceId,
        uploadedBy: actor.userId,
        kind: found?.kind ?? declaredKindOf(locked.mime),
        status: found ? 'processing' : 'failed',
        originalName: locked.originalName,
        mime: found?.mime ?? 'application/octet-stream',
        sizeBytes: locked.sizeBytes,
        sha256: stored?.sha256 ?? null,
        storageKey: stored?.key ?? null,
        // what the worker would say of it (FileAnalysis): no type Feedway takes
        analysis: found ? null : { kind: 'unknown', sizeBytes: locked.sizeBytes },
        folderId: locked.folderId,
      })
      await tx.uploads.complete(organizationId, session.id, mediaId, now)
      return { id: mediaId, created: true }
    })
  } catch (error) {
    await forget()
    try {
      await deps.uow.run(scope, (tx) => tx.uploads.releaseCompletion(organizationId, session.id))
    } catch (release) {
      // the hold ends by itself
      deps.logger.error({ err: release, uploadId: session.id }, 'upload completion not released')
    }
    throw error
  }
  if (!winner.created) {
    await forget()
    return media(winner.id)
  }
  try {
    await deps.uploadParts.remove(organizationId, session.id)
  } catch (error) {
    // the hourly clean-up removes them with the session
    deps.logger.error({ err: error, uploadId: session.id }, 'upload pieces not removed')
  }
  if (sniffed)
    try {
      await deps.queue.send('media.process', { organizationId, mediaId })
    } catch (error) {
      // the file waits as `processing`: the hourly clean-up wakes the worker for it
      deps.logger.error({ err: error, mediaId }, 'media processing not queued')
    }
  return media(mediaId)
}

/** Cancels an upload not complete: its pieces go and its space is free again. */
export async function cancelUpload(
  deps: UploadDeps,
  actor: OrgActor,
  input: { workspaceId: string; uploadId: string },
): Promise<void> {
  await limitUploads(deps, actor)
  const { organizationId } = actor
  const uploadId = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    const found = await ownUpload(tx, actor, workspace.id, input.uploadId, deps.clock.now(), {
      forUpdate: true,
    })
    if (found.completedAt !== null)
      throw new DomainError('CONFLICT', 'Il caricamento è già completato')
    await tx.uploads.delete(organizationId, found.id)
    return found.id
  })
  try {
    await deps.uploadParts.remove(organizationId, uploadId)
  } catch (error) {
    deps.logger.error({ err: error, uploadId }, 'upload pieces not removed')
  }
}

const declaredKindOf = (type: string) =>
  isUploadDeclaredType(type) ? declaredKind(type) : ('image' as const)
