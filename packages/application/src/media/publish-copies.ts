import {
  COVER_MAX_BYTES,
  MEDIA_PROCESS_MAX_ATTEMPTS,
  NINE_SIXTEEN,
  PHOTO_MAX_WIDTH,
  STORY_HEIGHT,
  STORY_VIDEO_MAX_BYTES,
  STORY_WIDTH,
  centerBox,
  lastFrameMs,
  mediaVariantKey,
  parseRecipe,
  type CopyFailure,
  type CopyRecipe,
  type CopyRequest,
  type FileLimits,
  type PublishFile,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { MediaRecord, PublishCopyRecord } from '../ports/media.js'
import type {
  ExclusiveLock,
  MadeFile,
  MediaScratch,
  MediaTransformer,
  ScratchFolder,
  ToolResult,
} from '../ports/media-processing.js'
import type { Storage } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { MEDIA_PROCESS_LOCK } from './process.js'
import { nextCopyTurn, wakeMediaWork } from './process-turn.js'

// The copies to publish (plan 07 Task 6, P4): asked for when a post is scheduled, made by the
// worker with `media.publish_copies`, read when a destination is prepared. The media module
// stays the only one that owns files, keys and public tokens: the posts module asks with the
// requests of `publishFilesOf` and reads back their state.

/** What `publishFilesOf` needs of the files the worker already made. */
export async function publishFileFacts(
  tx: Tx,
  organizationId: string,
  mediaIds: readonly string[],
): Promise<Map<string, Pick<PublishFile, 'feedCopyBytes' | 'hasReelCopy'>>> {
  const ids = [...new Set(mediaIds.filter(isUuid))]
  const copies = await tx.media.copiesOf(organizationId, ids)
  const plain = (id: string, purpose: string) =>
    copies.find(
      (c) => c.mediaId === id && c.purpose === purpose && c.recipe === '' && c.status === 'ready',
    )
  return new Map(
    ids.map((id) => [
      id,
      { feedCopyBytes: plain(id, 'ig_feed')?.sizeBytes ?? null, hasReelCopy: !!plain(id, 'reel') },
    ]),
  )
}

const EXTENSIONS = { image: 'jpg', video: 'mp4' } as const
const MIMES = { image: 'image/jpeg', video: 'video/mp4' } as const

/**
 * Asks for the copies with a recipe among `requests` (the others were made with their file):
 * `pending` rows with their key and public token, made later by `media.publish_copies`. A copy
 * asked for again is the same row; one that could not be made is tried again. Returns how many
 * are now waiting because of this call: the caller wakes the worker when there are some.
 */
export async function requestPublishCopies(
  tx: Tx,
  deps: { ids: IdGenerator; newPublicToken: () => string },
  scope: { organizationId: string; workspaceId: string },
  requests: readonly CopyRequest[],
): Promise<number> {
  const { organizationId } = scope
  const once = new Map(requests.map((r) => [`${r.mediaId}/${r.purpose}/${r.recipe}`, r]))
  const asked = [...once.values()].filter((r) => r.recipe !== '' && isUuid(r.mediaId))
  if (asked.length === 0) return 0
  // a file of another workspace or agency is not asked for: for the posts module it is no file
  const files = await tx.media.findManyInWorkspace(organizationId, scope.workspaceId, [
    ...new Set(asked.map((r) => r.mediaId)),
  ])
  const rows = asked.flatMap((r) => {
    const file = files.find((f) => f.id === r.mediaId)
    if (!file || file.status === 'deleted' || !parseRecipe(r.purpose, r.recipe)) return []
    // a story of a photo is a JPEG, of a video an MP4; the other purposes have one kind
    const kind = r.purpose === 'story' ? file.kind : r.purpose === 'reel' ? 'video' : 'image'
    return [
      {
        id: deps.ids.newId(),
        mediaId: r.mediaId,
        purpose: r.purpose,
        recipe: r.recipe,
        storageKey: mediaVariantKey(
          organizationId,
          r.mediaId,
          r.purpose,
          EXTENSIONS[kind],
          r.recipe,
        ),
        publicToken: deps.newPublicToken(),
        mime: MIMES[kind],
      },
    ]
  })
  return tx.media.requestCopies(organizationId, rows)
}

export type PublishCopyState =
  | {
      status: 'ready'
      copy: Pick<
        PublishCopyRecord,
        'id' | 'publicToken' | 'mime' | 'sizeBytes' | 'width' | 'height'
      >
    }
  | { status: 'pending' }
  | { status: 'failed'; failure: string }
  /** never asked for, or its file is gone */
  | { status: 'missing' }

/** The state of each request, in the same order. */
export async function publishCopiesOf(
  tx: Tx,
  organizationId: string,
  requests: readonly CopyRequest[],
): Promise<{ request: CopyRequest; state: PublishCopyState }[]> {
  const copies = await tx.media.copiesOf(organizationId, [
    ...new Set(requests.map((r) => r.mediaId).filter(isUuid)),
  ])
  return requests.map((request) => {
    const c = copies.find(
      (x) =>
        x.mediaId === request.mediaId &&
        x.purpose === request.purpose &&
        x.recipe === request.recipe,
    )
    const state: PublishCopyState =
      !c || (c.status === 'ready' && c.publicToken === null)
        ? { status: 'missing' }
        : c.status === 'ready'
          ? {
              status: 'ready',
              copy: {
                id: c.id,
                publicToken: c.publicToken,
                mime: c.mime,
                sizeBytes: c.sizeBytes,
                width: c.width,
                height: c.height,
              },
            }
          : c.status === 'failed'
            ? { status: 'failed', failure: c.failure ?? 'processing_failed' }
            : { status: 'pending' }
    return { request, state }
  })
}

/** A wake-up of the worker for the copies: the post that asked, for the logs. */
export interface PublishCopiesJob {
  organizationId: string
  postId: string | null
}

export interface PublishCopiesDeps {
  uow: UnitOfWork
  clock: Clock
  storage: Storage
  queue: Pick<JobQueue, 'send'>
  logger: Logger
  lock: ExclusiveLock
  scratch: MediaScratch
  transformer: MediaTransformer
  limits: FileLimits
}

export type PublishCopiesOutcome =
  | { outcome: 'busy' }
  | { outcome: 'idle' }
  | {
      outcome: 'made'
      organizationId: string
      variantId: string
      /** `gone`: its file was deleted, or the copy taken, meanwhile */
      status: 'ready' | 'failed' | 'gone'
    }

/**
 * One copy, the next at its agency's turn, under the lock of the conversions (`media.process`):
 * the worker converts one thing at a time (ADR 021, §16.6). Then the next wake-up, copy or
 * file, is queued.
 */
export async function makeNextPublishCopy(
  deps: PublishCopiesDeps,
  job: PublishCopiesJob & { jobId: string; signal?: AbortSignal | undefined },
): Promise<PublishCopiesOutcome> {
  if (!isUuid(job.organizationId)) throw new Error('publish copies job without organizationId')
  if (job.postId !== null && !isUuid(job.postId))
    throw new Error('publish copies job with a postId that is not one')
  let made = false
  const held = await deps.lock
    .tryRun(MEDIA_PROCESS_LOCK, async (): Promise<PublishCopiesOutcome> => {
      const turn = await nextCopyTurn(deps.uow)
      if (!turn) return { outcome: 'idle' }
      made = true
      const status = await makeCopy(deps, turn, job.signal)
      return { outcome: 'made', ...turn, status }
    })
    .finally(async () => {
      if (made) await wakeMediaWork(deps, `after:${job.jobId}`)
    })
  if (!held.acquired) return { outcome: 'busy' }
  return held.value
}

class Refused extends Error {
  constructor(readonly failure: CopyFailure) {
    super(failure)
  }
}

async function makeCopy(
  deps: PublishCopiesDeps,
  turn: { organizationId: string; variantId: string },
  signal: AbortSignal | undefined,
): Promise<'ready' | 'failed' | 'gone'> {
  const { organizationId, variantId } = turn
  const scope = { organizationId, userId: null }
  const copy = await deps.uow.run(scope, (tx) =>
    tx.media.claimCopy(organizationId, variantId, deps.clock.now()),
  )
  if (!copy) return 'gone'
  const log = deps.logger.child({ organizationId, variantId, attempt: copy.attempts })
  const fail = async (failure: CopyFailure) => {
    const failed = await deps.uow.run(scope, (tx) =>
      tx.media.failCopy(organizationId, variantId, failure),
    )
    log.info({ failure }, 'publish copy failed')
    return failed ? ('failed' as const) : ('gone' as const)
  }
  // picked again and again: the copy may be what stops the worker
  if (copy.attempts > MEDIA_PROCESS_MAX_ATTEMPTS) return fail('processing_failed')
  const recipe = parseRecipe(copy.purpose, copy.recipe)
  if (!recipe) return fail('processing_failed')
  try {
    const source = await deps.uow.run(scope, async (tx) => {
      const file = await tx.media.findById(organizationId, copy.mediaId)
      if (!file || file.status !== 'ready') return null
      if (file.kind === 'video') return file.storageKey ? { file, key: file.storageKey } : null
      // a photo's original is gone once processed: its copies start from the master (D-26)
      const master = (await tx.media.variantsOf(organizationId, [file.id])).find(
        (v) => v.purpose === 'master',
      )
      return master ? { file, key: master.storageKey } : null
    })
    if (!source) return await fail('media_unavailable')
    const folder = await deps.scratch.open()
    try {
      const made = await transform(deps, recipe, source.file, source.key, folder, signal)
      await deps.storage.put(copy.storageKey, folder.read(made.path), { contentType: made.mime })
      const finished = await deps.uow.run(scope, (tx) =>
        tx.media.finishCopy(organizationId, variantId, {
          sizeBytes: made.sizeBytes,
          width: made.width,
          height: made.height,
        }),
      )
      if (!finished) {
        // its file was deleted meanwhile: the copy goes with it
        await deps.storage.delete(copy.storageKey).catch((error: unknown) => {
          log.error({ err: error }, 'publish copy not removed')
        })
        return 'gone'
      }
      log.info({ purpose: copy.purpose, recipe: copy.recipe }, 'publish copy made')
      return 'ready'
    } finally {
      await folder.dispose()
    }
  } catch (error) {
    if (error instanceof Refused) return fail(error.failure)
    // a passing failure (storage, database, disk, the job's expiry): retried by the queue
    try {
      await deps.uow.run(scope, (tx) => tx.media.releaseCopyAttempt(organizationId, variantId))
    } catch (release) {
      log.error({ err: release }, 'publish copy attempt not given back')
    }
    throw error
  }
}

/** A refusal of the tools is the copy's failure; the job's own signal is retried. */
function madeOr(result: ToolResult<{ file: MadeFile }>): MadeFile {
  if (result.ok) return result.file
  if (result.reason === 'aborted') throw new Error('publish copy stopped by the job signal')
  throw new Refused(result.reason)
}

async function transform(
  deps: PublishCopiesDeps,
  recipe: CopyRecipe,
  file: MediaRecord,
  sourceKey: string,
  folder: ScratchFolder,
  signal: AbortSignal | undefined,
): Promise<MadeFile> {
  const stored = await deps.storage.get(sourceKey)
  if (!stored) throw new Refused('media_unavailable')
  const input = await folder.write('source', stored.body)
  const t = deps.transformer
  const maxPixels = deps.limits.maxImagePixels
  const photo = (
    path: string,
    opts: Omit<Parameters<MediaTransformer['photo']>[2], 'format' | 'maxPixels' | 'signal'>,
  ) => t.photo(path, folder.path('copy.jpg'), { ...opts, format: 'jpeg', maxPixels, signal })
  const video = () => {
    const { width, height, durationMs, fps } = file
    if (width === null || height === null || durationMs === null || fps === null)
      throw new Refused('unreadable')
    return { width, height, durationMs, fps, sizeBytes: file.sizeBytes, signal }
  }
  const feed = { maxWidth: PHOTO_MAX_WIDTH, maxBytes: deps.limits.photoMaxBytes.instagram }
  switch (recipe.kind) {
    case 'crop':
      return madeOr(await photo(input, { ...feed, crop: recipe.box }))
    case 'pad':
      return madeOr(
        await photo(input, { ...feed, pad: { ratio: recipe.ratio, background: 'white' } }),
      )
    case 'facebook':
      return madeOr(
        await photo(input, {
          maxWidth: PHOTO_MAX_WIDTH,
          maxBytes: deps.limits.photoMaxBytes.facebook,
        }),
      )
    case 'reel':
      return madeOr(
        await t.videoFit(input, folder.path('copy.mp4'), {
          ...video(),
          fit: recipe.fit,
          trimMs: null,
          maxBytes: null,
        }),
      )
    case 'story':
      if (file.kind === 'video')
        return madeOr(
          await t.videoFit(input, folder.path('copy.mp4'), {
            ...video(),
            fit: 'pad',
            trimMs: recipe.trimMs,
            maxBytes: STORY_VIDEO_MAX_BYTES,
          }),
        )
      return madeOr(
        await photo(input, {
          maxWidth: STORY_WIDTH,
          maxHeight: STORY_HEIGHT,
          maxBytes: deps.limits.photoMaxBytes.instagram,
          pad: { ratio: NINE_SIXTEEN, background: 'black' },
        }),
      )
    case 'frame': {
      const v = video()
      // a frame at the very end of the video is accepted (D-60): its last true frame is taken
      const still = madeOr(
        await t.videoStill(input, folder.path('frame.jpg'), {
          ...v,
          atMs: Math.min(recipe.atMs, lastFrameMs(v.durationMs, v.fps)),
        }),
      )
      return madeOr(
        await photo(still.path, {
          maxWidth: STORY_WIDTH,
          maxHeight: STORY_HEIGHT,
          maxBytes: COVER_MAX_BYTES,
          ...(recipe.fit === 'pad'
            ? { pad: { ratio: NINE_SIXTEEN, background: 'black' as const } }
            : { crop: centerBox(still.width, still.height, NINE_SIXTEEN) }),
        }),
      )
    }
    case 'cover':
      return madeOr(
        await photo(input, {
          maxWidth: STORY_WIDTH,
          maxHeight: STORY_HEIGHT,
          maxBytes: COVER_MAX_BYTES,
          ...(recipe.box ? { crop: recipe.box } : {}),
        }),
      )
  }
}
