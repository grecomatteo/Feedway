import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  publishCopiesOf,
  publishFileFacts,
  readPublicMediaFile,
  requestPublishCopies,
} from '@app/application'
import { recipeKey, type CopyRecipe, type CopyRequest, recipePurpose } from '@app/domain'
import { createRuntime, newPublicToken, type Runtime } from '@app/infrastructure'
import {
  imageInfo,
  jpegOfSizeWithGps,
  makeVideo,
  probeFile,
  seed,
  startTestDatabase,
  type TestDatabase,
} from '@app/infrastructure/testing'
import type { JobHandlerDeps } from '../job-handler.js'
import { recordingQueue } from '../../tests/accounts-jobs.js'
import { mediaToolsFor } from '../../tests/media-tools.js'
import { mediaProcess } from './media-process.js'
import { mediaPublishCopies } from './media-publish-copies.js'

// `media.publish_copies` (plan 07 Task 6): the copies a scheduled post asks of its files, made
// with ffmpeg and sharp for real, against the database and a storage on disk.

let tdb: TestDatabase
let runtime: Runtime
let admin: pg.Client
let dir: string

interface Agency {
  org: string
  workspace: string
  owner: string
}

async function agency(): Promise<Agency> {
  return seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const owner = await s.user()
    await s.member(org, owner, 'owner')
    return { org, owner, workspace: await s.workspace(org) }
  })
}

function deps(queue = recordingQueue()) {
  return {
    logger: runtime.logger,
    uow: runtime.uow,
    clock: runtime.clock,
    ids: runtime.ids,
    storage: runtime.storage,
    queue,
    media: mediaToolsFor(runtime),
  } as unknown as JobHandlerDeps & { queue: ReturnType<typeof recordingQueue> }
}

/** A file uploaded and processed by `media.process`, as the library has it. */
async function ready(of: Agency, bytes: Buffer, ext: 'jpg' | 'mp4'): Promise<string> {
  const kind = ext === 'mp4' ? 'video' : 'image'
  const mime = ext === 'mp4' ? 'video/mp4' : 'image/jpeg'
  const id = await seed(tdb.runtimeUrl, (s) =>
    s.media(of.org, of.workspace, { uploadedBy: of.owner, kind, status: 'processing' }),
  )
  const key = `org/${of.org}/media/${id}/original.${ext}`
  await runtime.storage.put(key, bytes, { contentType: mime })
  await admin.query('update media set storage_key = $2, mime = $3, size_bytes = $4 where id = $1', [
    id,
    key,
    mime,
    bytes.length,
  ])
  await mediaProcess({ id: `process-${id}`, data: { organizationId: of.org, mediaId: id } }, deps())
  const status = await admin.query<{ status: string }>('select status from media where id = $1', [
    id,
  ])
  expect(status.rows[0]?.status).toBe('ready')
  return id
}

const request = (mediaId: string, recipe: CopyRecipe): CopyRequest => ({
  mediaId,
  purpose: recipePurpose(recipe),
  recipe: recipeKey(recipe),
})

const ask = (of: Agency, requests: CopyRequest[]) =>
  runtime.uow.run({ organizationId: of.org, userId: of.owner }, (tx) =>
    requestPublishCopies(
      tx,
      { ids: runtime.ids, newPublicToken },
      { organizationId: of.org, workspaceId: of.workspace },
      requests,
    ),
  )

const stateOf = async (of: Agency, r: CopyRequest) => {
  const [found] = await runtime.uow.run({ organizationId: of.org, userId: of.owner }, (tx) =>
    publishCopiesOf(tx, of.org, [r]),
  )
  return found?.state
}

const make = (of: Agency, d = deps(), jobId = 'copie') =>
  mediaPublishCopies({ id: jobId, data: { organizationId: of.org, postId: null } }, d)

async function copyRow(mediaId: string, recipe: string) {
  const res = await admin.query<{
    id: string
    status: string
    failure: string | null
    storage_key: string
    public_token: string | null
    mime: string
    size_bytes: string
    width: number | null
    height: number | null
    attempts: number
  }>('select * from media_variants where media_id = $1 and recipe = $2', [mediaId, recipe])
  return res.rows
}

/** A stored file, copied out for ffprobe and sharp. */
async function local(key: string, name: string): Promise<string> {
  const object = await runtime.storage.get(key)
  if (!object) throw new Error(`${key} is not stored`)
  const chunks: Uint8Array[] = []
  for await (const c of object.body) chunks.push(c)
  const path = join(dir, name)
  await writeFile(path, Buffer.concat(chunks))
  return path
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  runtime = await createRuntime(
    {
      nodeEnv: 'production',
      databaseUrl: tdb.runtimeUrl,
      encryptionKey: randomBytes(32),
      logLevel: 'error',
      mediaRoot: await mkdtemp(join(tmpdir(), 'publish-copies-')),
    },
    'worker',
  )
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  dir = await mkdtemp(join(tmpdir(), 'publish-copies-files-'))
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await admin.end()
  await tdb.stop()
})

// every test starts with no copy waiting: the job picks across the agencies
beforeEach(async () => {
  await admin.query(
    `update media_variants set status = 'failed', failure = 'unreadable' where status = 'pending'`,
  )
})

test('a photo cut to its box: 4:5, JPEG sRGB without metadata, served by /m/*', async () => {
  const a = await agency()
  const id = await ready(a, await jpegOfSizeWithGps(3000, 4500), 'jpg')
  const crop = request(id, { kind: 'crop', box: { x: 0, y: 0.1, width: 1, height: 0.8333 } })
  expect(await ask(a, [crop])).toBe(1)
  expect(await stateOf(a, crop)).toEqual({ status: 'pending' })

  const d = deps()
  await make(a, d)
  const [row] = await copyRow(id, crop.recipe)
  expect(row).toMatchObject({ status: 'ready', mime: 'image/jpeg', width: 1440 })
  expect(row?.height).toBe(1800)
  expect(Number(row?.size_bytes)).toBeGreaterThan(0)
  expect(Number(row?.size_bytes)).toBeLessThanOrEqual(8_000_000)
  const meta = await imageInfo(await readFile(await local(row?.storage_key ?? '', 'crop.jpg')))
  expect(meta).toMatchObject({ format: 'jpeg', width: 1440, height: 1800, exif: false })

  const state = await stateOf(a, crop)
  expect(state?.status).toBe('ready')
  const served = await readPublicMediaFile(runtime, {
    name: `${row?.public_token ?? ''}.jpg`,
    range: null,
  })
  expect(served).toMatchObject({ kind: 'whole', contentType: 'image/jpeg' })
  expect(served?.etag).toBe(row?.id)
  // the next file or copy waiting gets its wake-up: none here
  expect(d.queue.sent).toEqual([])
})

test('the same recipe asked twice, by two posts, is one copy made once', async () => {
  const a = await agency()
  const id = await ready(a, await jpegOfSizeWithGps(1000, 2000), 'jpg')
  const pad = request(id, { kind: 'pad', ratio: 0.8 })
  expect(await ask(a, [pad, pad])).toBe(1)
  expect(await ask(a, [pad])).toBe(0)
  await make(a)
  await make(a, deps(), 'copie-2')
  const rows = await copyRow(id, pad.recipe)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ status: 'ready', attempts: 1, width: 1440, height: 1800 })
  // ready: asked again, it stays as it is
  expect(await ask(a, [pad])).toBe(0)
})

test('the facts of the files: the feed copy’s weight and the copy for the Reels', async () => {
  const a = await agency()
  const photo = await ready(a, await jpegOfSizeWithGps(800, 1000), 'jpg')
  const facts = await runtime.uow.run({ organizationId: a.org, userId: a.owner }, (tx) =>
    publishFileFacts(tx, a.org, [photo]),
  )
  expect(facts.get(photo)?.feedCopyBytes).toBeGreaterThan(0)
  expect(facts.get(photo)?.hasReelCopy).toBe(false)
})

test('a 16:9 reel with bands, and its cover from the last true frame, cut to 9:16', async () => {
  const a = await agency()
  const id = await ready(a, await readFile(makeVideo(dir, 'wide.mp4')), 'mp4')
  const reel = request(id, { kind: 'reel', fit: 'pad' })
  // 3 s at 25 fps: the very end is taken as the last true frame (D-60)
  const cover = request(id, { kind: 'frame', atMs: 3000, fit: 'crop' })
  expect(await ask(a, [reel, cover])).toBe(2)
  const d = deps()
  await make(a, d)
  // the second copy waits for its own wake-up, queued after the first
  expect(d.queue.sent.map((s) => s.name)).toEqual(['media.publish_copies'])
  await make(a, deps(), 'copie-2')

  const [video] = await copyRow(id, reel.recipe)
  expect(video).toMatchObject({ status: 'ready', mime: 'video/mp4', width: 640, height: 1136 })
  const streams = probeFile(await local(video?.storage_key ?? '', 'reel.mp4')).streams
  expect(streams.find((s) => s.codec_type === 'video')).toMatchObject({
    codec_name: 'h264',
    width: 640,
    height: 1136,
  })
  const [frame] = await copyRow(id, cover.recipe)
  expect(frame).toMatchObject({ status: 'ready', mime: 'image/jpeg', width: 203, height: 360 })
  expect(Number(frame?.size_bytes)).toBeLessThanOrEqual(8_000_000)
})

test('a copy that cannot be made is failed with its reason, and tried again when asked', async () => {
  const a = await agency()
  const id = await ready(a, await readFile(makeVideo(dir, 'wide.mp4')), 'mp4')
  const reel = request(id, { kind: 'reel', fit: 'crop' })
  await ask(a, [reel])
  // the original is lost (a disk restored without it)
  await admin.query(
    `update media set storage_key = 'org/' || organization_id || '/media/' || id || '/gone.mp4' where id = $1`,
    [id],
  )
  await make(a)
  expect(await stateOf(a, reel)).toEqual({ status: 'failed', failure: 'media_unavailable' })
  expect(await ask(a, [reel])).toBe(1)
  expect(await stateOf(a, reel)).toEqual({ status: 'pending' })
})

test('a copy of a file of another workspace is not asked for', async () => {
  const a = await agency()
  const b = await agency()
  const theirs = await ready(b, await jpegOfSizeWithGps(1000, 2000), 'jpg')
  const pad = request(theirs, { kind: 'pad', ratio: 0.8 })
  expect(await ask(a, [pad])).toBe(0)
  expect(await copyRow(theirs, pad.recipe)).toEqual([])
})
