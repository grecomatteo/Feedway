import {
  INSTAGRAM_PHOTO_MAX_BYTES,
  MEDIA_PROCESS_MAX_ATTEMPTS,
  PHOTO_MAX_WIDTH,
  checkFile,
  checkStorage,
  isPublishableVideo,
  mediaPrefix,
  mediaVariantKey,
  parseLimits,
  thumbnailSize,
  type FileAnalysis,
  type FileLimits,
  type MediaChecks,
  type MediaFailure,
  type MediaStep,
  type VariantPurpose,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { MediaFacts, MediaRecord, MediaTurn } from '../ports/media.js'
import type {
  ExclusiveLock,
  MadeFile,
  MediaProbe,
  MediaScratch,
  MediaTransformer,
  ScratchFolder,
  ToolRefusal,
} from '../ports/media-processing.js'
import type { Storage } from '../ports/storage.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { nextMediaTurn } from './process-turn.js'

// `media.process` (RF-31, RF-38; plan 04 Task 10, ADR 021). The job is a wake-up: one
// conversion at a time for the whole installation (an advisory lock), and the file processed
// is the next one at its agency's turn, not necessarily the one the job names. Each job
// processes one file, in that file's agency scope, then wakes the next one.

export interface MediaProcessJob {
  organizationId: string
  mediaId: string
}

export interface MediaProcessDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  storage: Storage
  queue: Pick<JobQueue, 'send'>
  logger: Logger
  lock: ExclusiveLock
  scratch: MediaScratch
  probe: MediaProbe
  transformer: MediaTransformer
  /** 32 characters, for the copy to publish (spec §16.1) */
  newPublicToken: () => string
  /** MEDIA_MAX_* and MEDIA_WORKSPACE_MAX_BYTES */
  limits: FileLimits & { workspaceMaxBytes: number | null }
}

export type MediaProcessOutcome =
  /** another conversion is running: it wakes the next file when it ends */
  | { outcome: 'busy' }
  /** no file waits */
  | { outcome: 'idle' }
  | {
      outcome: 'processed'
      organizationId: string
      mediaId: string
      /** `gone`: deleted, or taken, meanwhile */
      status: 'ready' | 'failed' | 'gone'
    }

/** The lock of the whole installation (ADR 021, Scelta 7). */
export const MEDIA_PROCESS_LOCK = 'media.process'
/** A worker folder left older than the job's expiry is from a worker that died. */
const SCRATCH_MAX_AGE_MS = 3 * 3600_000
/** The panel reads the progress every few seconds; the database is spared the rest. */
const PROGRESS_EVERY_MS = 5_000

/**
 * Takes the lock, processes the next file at its turn, gives the lock back and, if files still
 * wait, queues the next wake-up. `jobId` names that wake-up, so a retried job does not queue it
 * twice.
 */
export async function processNextMedia(
  deps: MediaProcessDeps,
  job: MediaProcessJob & { jobId: string; signal?: AbortSignal | undefined },
): Promise<MediaProcessOutcome> {
  if (!isUuid(job.organizationId)) throw new Error('media process job without organizationId')
  if (!isUuid(job.mediaId)) throw new Error('media process job without mediaId')
  let processed = false
  const held = await deps.lock
    .tryRun(MEDIA_PROCESS_LOCK, async (): Promise<MediaProcessOutcome> => {
      try {
        await deps.scratch.sweep(SCRATCH_MAX_AGE_MS)
      } catch (error) {
        deps.logger.warn({ err: error }, 'old media work folders not removed')
      }
      const turn = await nextMediaTurn(deps.uow)
      if (!turn) return { outcome: 'idle' }
      processed = true
      const status = await processMedia(deps, turn, job.signal)
      return { outcome: 'processed', ...turn, status }
    })
    .finally(async () => {
      // after the lock is free, even after a failure: a wake-up that came meanwhile found it
      // taken and left, so the next file (of another agency, maybe) waits for this one
      if (!processed) return
      try {
        const next = await nextMediaTurn(deps.uow)
        if (next) await deps.queue.send('media.process', next, { dedupeKey: `after:${job.jobId}` })
      } catch (error) {
        // the clean-up, every ten minutes, wakes files left waiting
        deps.logger.error({ err: error }, 'next media wake-up not queued')
      }
    })
  if (!held.acquired) return { outcome: 'busy' }
  return held.value
}

/**
 * At the worker's start: the lock died with the worker before, so the file it left `processing`
 * (or the next at its turn) goes on at once instead of waiting for the clean-up. A file the
 * worker stopped on keeps its attempt: three of them and it fails (D-02).
 */
export async function wakeMediaProcessing(
  deps: Pick<MediaProcessDeps, 'uow' | 'queue' | 'logger'>,
): Promise<void> {
  try {
    const next = await nextMediaTurn(deps.uow)
    if (next) await deps.queue.send('media.process', next)
  } catch (error) {
    // the clean-up wakes files left waiting
    deps.logger.error({ err: error }, 'media wake-up at start not queued')
  }
}

class FileGone extends Error {}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'video/mp4': 'mp4' }

function factsOf(analysis: FileAnalysis): MediaFacts {
  if (analysis.kind === 'unknown')
    return {
      analysis,
      width: null,
      height: null,
      durationMs: null,
      fps: null,
      videoCodec: null,
      audioCodec: null,
    }
  const video = analysis.kind === 'video' ? analysis : null
  return {
    analysis,
    width: analysis.width,
    height: analysis.height,
    durationMs: video?.durationMs ?? null,
    fps: video?.fps ?? null,
    videoCodec: video?.videoCodec ?? null,
    audioCodec: video?.audioCodec ?? null,
  }
}

interface Made {
  purpose: VariantPurpose
  file: MadeFile
  publicToken: string | null
}

/** One file, in its agency's scope. Only passing failures throw (to be retried). */
async function processMedia(
  deps: MediaProcessDeps,
  turn: MediaTurn,
  signal: AbortSignal | undefined,
): Promise<'ready' | 'failed' | 'gone'> {
  const { organizationId, mediaId } = turn
  const scope = { organizationId, userId: null }
  const record = await deps.uow.run(scope, (tx) =>
    tx.media.claimProcessing(organizationId, mediaId, deps.clock.now()),
  )
  if (!record) return 'gone'
  const log = deps.logger.child({ organizationId, mediaId, attempt: record.processingAttempts })
  // picked again and again: the file may be what stops the worker (memory, a crash)
  if (record.processingAttempts > MEDIA_PROCESS_MAX_ATTEMPTS)
    return fail(deps, record, { code: 'processing_failed' }, null)
  const key = record.storageKey
  if (key === null) return fail(deps, record, { code: 'unreadable' }, null)
  try {
    const folder = await deps.scratch.open()
    try {
      const status = await processIn(deps, record, key, folder, signal)
      log.info({ status }, 'media processed')
      return status
    } finally {
      await folder.dispose()
    }
  } catch (error) {
    // a passing failure (storage, database, disk, the job's expiry): retried by the queue, and
    // not counted against the file
    try {
      await deps.uow.run(scope, (tx) => tx.media.releaseAttempt(organizationId, mediaId))
    } catch (release) {
      log.error({ err: release }, 'media attempt not given back')
    }
    throw error
  }
}

async function processIn(
  deps: MediaProcessDeps,
  record: MediaRecord,
  originalKey: string,
  folder: ScratchFolder,
  signal: AbortSignal | undefined,
): Promise<'ready' | 'failed' | 'gone'> {
  const progress = progressWriter(deps, record)
  const refused = async (reason: ToolRefusal, facts: MediaFacts | null) => {
    // the job's expiry: pg-boss retries it, and the attempts keep count
    if (reason === 'aborted') throw new Error('media processing stopped by the job signal')
    await progress.flush()
    return fail(deps, record, { code: reason }, facts)
  }

  const original = await deps.storage.get(originalKey)
  if (!original) return fail(deps, record, { code: 'unreadable' }, null)
  const input = await folder.write('original', original.body)
  const probed = await deps.probe.analyze(input, { signal })
  if (!probed.ok) return refused(probed.reason, null)
  const { analysis } = probed
  const facts = factsOf(analysis)
  const check = checkFile(analysis, deps.limits)
  // blocked (§9.2): nothing is decoded
  const block = check.blocks[0]
  if (block) return fail(deps, record, block, facts)
  if (analysis.kind === 'unknown') return fail(deps, record, { code: 'unsupported_type' }, facts)
  progress.set('conversion', 10, true)

  const made: Made[] = []
  if (analysis.kind === 'video') {
    // the preview first (plan 04, Scelta 5): the panel shows the video as soon as it is ready
    const preview = await deps.transformer.videoPreview(input, folder.path('preview.mp4'), {
      signal,
      width: analysis.width,
      height: analysis.height,
      durationMs: analysis.durationMs,
      onProgress: (fraction) => {
        progress.set('conversion', 10 + Math.round(fraction * 60))
      },
    })
    if (!preview.ok) return refused(preview.reason, facts)
    const previewMade: Made = { purpose: 'preview', file: preview.file, publicToken: null }
    await store(deps, record, folder, previewMade)
    await deps.uow.run({ organizationId: record.organizationId, userId: null }, (tx) =>
      tx.media.saveVariant(record.organizationId, record.id, variantRow(deps, record, previewMade)),
    )
    progress.set('conversion', 75, true)
    // the copy to publish, without encoding again (§16.6); a codec Meta does not take is a
    // choice for the editor (stage 6), so the file has no copy to publish yet
    if (isPublishableVideo(analysis)) {
      const reel = await deps.transformer.videoRemux(input, folder.path('reel.mp4'), {
        signal,
        videoCodec: analysis.videoCodec,
        durationMs: analysis.durationMs,
        width: analysis.width,
        height: analysis.height,
      })
      if (!reel.ok) return refused(reel.reason, facts)
      made.push({ purpose: 'reel', file: reel.file, publicToken: deps.newPublicToken() })
    }
    const frame = await deps.transformer.videoFrame(
      preview.file.path,
      folder.path('thumbnail.jpg'),
      {
        signal,
        atMs: Math.min(1000, Math.floor(analysis.durationMs / 2)),
        ...thumbnailSize(preview.file.width, preview.file.height),
      },
    )
    if (!frame.ok) return refused(frame.reason, facts)
    made.push({ purpose: 'thumbnail', file: frame.file, publicToken: null })
  } else {
    // decoding the whole photo validates it: this is where broken bytes show
    const photo = await deps.transformer.photo(input, folder.path('ig_feed.jpg'), {
      signal,
      format: analysis.format,
      maxWidth: PHOTO_MAX_WIDTH,
      maxBytes: INSTAGRAM_PHOTO_MAX_BYTES,
      maxPixels: deps.limits.maxImagePixels,
    })
    if (!photo.ok) return refused(photo.reason, facts)
    progress.set('conversion', 70, true)
    const thumb = await deps.transformer.thumbnail(photo.file.path, folder.path('thumbnail.jpg'), {
      signal,
    })
    if (!thumb.ok) return refused(thumb.reason, facts)
    made.push(
      { purpose: 'ig_feed', file: photo.file, publicToken: deps.newPublicToken() },
      { purpose: 'thumbnail', file: thumb.file, publicToken: null },
    )
  }
  await progress.flush()
  return finish(deps, record, folder, made, {
    facts,
    checks: { fixes: check.fixes, warnings: check.warnings },
  })
}

/** The copies are stored, then written with the file `ready` if they fit in the space left. */
async function finish(
  deps: MediaProcessDeps,
  record: MediaRecord,
  folder: ScratchFolder,
  made: Made[],
  result: { facts: MediaFacts; checks: MediaChecks },
): Promise<'ready' | 'failed' | 'gone'> {
  const { organizationId } = record
  const image = record.kind === 'image'
  const keys: string[] = []
  for (const m of made) keys.push(await store(deps, record, folder, m))
  // a photo's original goes once its copy is ready (§15.7): it frees its own space
  const adding = made.reduce((sum, m) => sum + m.file.sizeBytes, 0) - (image ? record.sizeBytes : 0)
  let outcome: { ok: true } | { ok: false; failure: MediaFailure }
  try {
    outcome = await deps.uow.run({ organizationId, userId: null }, async (tx) => {
      // no upload reserves space between the reading and the writing below
      await tx.uploads.lockReservations(organizationId)
      if (adding > 0) {
        const organization = await tx.organizations.findById(organizationId)
        const now = deps.clock.now()
        const used = await tx.media.storageUsed(organizationId, record.workspaceId)
        const reserved = await tx.uploads.reservedBytes(organizationId, record.workspaceId, now)
        const check = checkStorage(
          {
            limits: parseLimits(organization?.limits ?? {}),
            workspaceMaxBytes: deps.limits.workspaceMaxBytes,
          },
          {
            organization: used.organization + reserved.organization,
            workspace: used.workspace + reserved.workspace,
          },
          adding,
        )
        if (!check.ok)
          return {
            ok: false as const,
            failure: { code: 'storage_full' as const, scope: check.scope, limit: check.limit },
          }
      }
      for (const m of made)
        await tx.media.saveVariant(organizationId, record.id, variantRow(deps, record, m))
      const ready = await tx.media.markReady(organizationId, record.id, {
        ...result.facts,
        checks: result.checks,
        forgetOriginal: image,
      })
      // deleted meanwhile: no copy row is left behind
      if (!ready) throw new FileGone()
      return { ok: true as const }
    })
  } catch (error) {
    if (!(error instanceof FileGone)) {
      await removeKeys(deps, keys)
      throw error
    }
    // deleted while it was processed: what `media.delete_files` does, whether it ran already
    await deps.storage.deletePrefix(mediaPrefix(organizationId, record.id))
    await deps.uow.run({ organizationId, userId: null }, (tx) =>
      tx.media.forgetFiles(organizationId, record.id),
    )
    return 'gone'
  }
  if (!outcome.ok) return fail(deps, record, outcome.failure, result.facts, keys)
  if (image && record.storageKey !== null)
    try {
      await deps.storage.delete(record.storageKey)
    } catch (error) {
      // its key is cleared: `media.delete_files` removes the folder when the file is deleted
      deps.logger.error({ err: error, mediaId: record.id }, 'photo original not removed')
    }
  return 'ready'
}

function variantRow(deps: MediaProcessDeps, record: MediaRecord, m: Made) {
  return {
    id: deps.ids.newId(),
    purpose: m.purpose,
    storageKey: keyOf(record, m),
    publicToken: m.publicToken,
    mime: m.file.mime,
    sizeBytes: m.file.sizeBytes,
    width: m.file.width,
    height: m.file.height,
  }
}

function keyOf(record: MediaRecord, m: Made): string {
  const extension = EXTENSIONS[m.file.mime]
  if (extension === undefined) throw new Error(`no extension for ${m.file.mime}`)
  return mediaVariantKey(record.organizationId, record.id, m.purpose, extension)
}

async function store(
  deps: MediaProcessDeps,
  record: MediaRecord,
  folder: ScratchFolder,
  m: Made,
): Promise<string> {
  const key = keyOf(record, m)
  await deps.storage.put(key, folder.read(m.file.path), { contentType: m.file.mime })
  return key
}

async function removeKeys(deps: MediaProcessDeps, keys: readonly string[]) {
  for (const key of keys)
    try {
      await deps.storage.delete(key)
    } catch (error) {
      deps.logger.error({ err: error }, 'media copy not removed')
    }
}

/**
 * `failed` with its reason, never retried; its copies go (the preview too). `extra`: copies
 * stored without a row yet. The refusals are final, so the original goes as well, with its GPS
 * (§15.7). `processing_failed` and `timeout`, where the fault may be ours (a worker that keeps
 * falling, a slow server), keep it to try again one day.
 */
const KEEPS_ORIGINAL: ReadonlySet<MediaFailure['code']> = new Set(['processing_failed', 'timeout'])

async function fail(
  deps: MediaProcessDeps,
  record: MediaRecord,
  failure: MediaFailure,
  facts: MediaFacts | null,
  extra: readonly string[] = [],
): Promise<'failed' | 'gone'> {
  const { organizationId } = record
  const forgetOriginal = !KEEPS_ORIGINAL.has(failure.code)
  const dropped = await deps.uow.run({ organizationId, userId: null }, async (tx) => {
    if (!(await tx.media.markFailed(organizationId, record.id, { failure, facts, forgetOriginal })))
      return null
    return tx.media.dropVariants(organizationId, record.id)
  })
  const original = forgetOriginal && dropped !== null ? record.storageKey : null
  await removeKeys(deps, [
    ...new Set([...(dropped ?? []), ...extra, ...(original ? [original] : [])]),
  ])
  deps.logger.info({ mediaId: record.id, failure }, 'media failed')
  return dropped === null ? 'gone' : 'failed'
}

/** The progress for the panel, at most every few seconds unless forced. */
function progressWriter(deps: MediaProcessDeps, record: MediaRecord) {
  const { organizationId } = record
  let last = 0
  let pending: Promise<void> = Promise.resolve()
  return {
    set(step: MediaStep, percent: number, force = false) {
      const now = deps.clock.now().getTime()
      if (!force && now - last < PROGRESS_EVERY_MS) return
      last = now
      pending = pending
        .then(() =>
          deps.uow.run({ organizationId, userId: null }, (tx) =>
            tx.media.setProgress(organizationId, record.id, { step, percent }),
          ),
        )
        .then(
          () => undefined,
          (error: unknown) => {
            deps.logger.warn({ err: error, mediaId: record.id }, 'media progress not saved')
          },
        )
    },
    flush: () => pending,
  }
}
