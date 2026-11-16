import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import type { MediaTransformer } from '@app/application'
import {
  createAdvisoryLock,
  createDb,
  createRuntime,
  type DbHandle,
  type Runtime,
} from '@app/infrastructure'
import {
  displayP3Png,
  firstPixel,
  imageInfo,
  hlsBehindFtyp,
  hlsPlaylist,
  imageFixture,
  jpegOfSizeWithGps,
  makeVideo,
  pngBomb,
  probeFile,
  seed,
  startTestDatabase,
  withScope,
  type TestDatabase,
} from '@app/infrastructure/testing'
import type { JobHandlerDeps } from '../job-handler.js'
import { recordingQueue } from '../../tests/accounts-jobs.js'
import { mediaToolsFor } from '../../tests/media-tools.js'
import { mediaProcess } from './media-process.js'

// `media.process` (plan 04 Task 10): the worker's processing of the files, with ffmpeg, ffprobe
// and sharp for real, against the database and a storage on disk.

let tdb: TestDatabase
let runtime: Runtime
let second: DbHandle
let admin: pg.Client
let dir: string
let server: Server
let hits = 0
let url: string

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

const MIME = {
  heic: 'image/heic',
  png: 'image/png',
  jpg: 'image/jpeg',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
} as const

/** A file just uploaded, waiting: its original stored as the completion stores it. */
async function waiting(of: Agency, bytes: Buffer, ext: keyof typeof MIME): Promise<string> {
  const kind = MIME[ext].startsWith('video/') ? 'video' : 'image'
  const id = await seed(tdb.runtimeUrl, (s) =>
    s.media(of.org, of.workspace, { uploadedBy: of.owner, kind, status: 'processing' }),
  )
  const key = `org/${of.org}/media/${id}/original.${ext}`
  await runtime.storage.put(key, bytes, { contentType: MIME[ext] })
  await admin.query('update media set storage_key = $2, mime = $3, size_bytes = $4 where id = $1', [
    id,
    key,
    MIME[ext],
    bytes.length,
  ])
  return id
}

const video = async (name: Parameters<typeof makeVideo>[1]) => readFile(makeVideo(dir, name))

interface Calls {
  names: string[]
}

/** The real tools, counting the transformer's calls; `around` runs inside each call. */
function tools(
  opts: { calls?: Calls; around?: (name: string) => Promise<void>; pool?: pg.Pool } = {},
) {
  const real = mediaToolsFor(runtime)
  const transformer = Object.fromEntries(
    Object.entries(real.transformer).map(([name, fn]) => [
      name,
      async (...args: unknown[]) => {
        opts.calls?.names.push(name)
        await opts.around?.(name)
        return (fn as (...a: unknown[]) => Promise<unknown>)(...args)
      },
    ]),
  ) as unknown as MediaTransformer
  return {
    ...real,
    transformer,
    ...(opts.pool && { lock: createAdvisoryLock(opts.pool) }),
  }
}

function deps(
  media: JobHandlerDeps['media'] = tools(),
  queue = recordingQueue(),
): JobHandlerDeps & { queue: ReturnType<typeof recordingQueue> } {
  return {
    logger: runtime.logger,
    uow: runtime.uow,
    clock: runtime.clock,
    ids: runtime.ids,
    storage: runtime.storage,
    queue,
    media,
  } as unknown as JobHandlerDeps & { queue: ReturnType<typeof recordingQueue> }
}

const wake = (d: JobHandlerDeps, of: Agency, mediaId: string, jobId = 'lavoro') =>
  mediaProcess({ id: jobId, data: { organizationId: of.org, mediaId } }, d)

async function row(id: string) {
  const res = await admin.query<{
    status: string
    storage_key: string | null
    failure: { code: string } | null
    checks: { fixes: { code: string }[]; warnings: { code: string }[] } | null
    progress: { step: string; percent: number } | null
    width: number | null
    height: number | null
    duration_ms: number | null
    video_codec: string | null
    processing_attempts: number
  }>('select * from media where id = $1', [id])
  return res.rows[0]
}

async function variants(id: string) {
  const res = await admin.query<{
    id: string
    purpose: string
    storage_key: string
    public_token: string | null
    mime: string
    size_bytes: number
  }>('select * from media_variants where media_id = $1 order by purpose', [id])
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
      mediaRoot: await mkdtemp(join(tmpdir(), 'media-process-')),
    },
    'worker',
  )
  second = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'worker-2' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  dir = await mkdtemp(join(tmpdir(), 'media-process-files-'))
  server = createServer((_req, res) => {
    hits += 1
    res.end('#EXTM3U\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}, 120_000)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await second.close()
  await admin.end()
  await tdb.stop()
})

// every test starts with no file waiting: the job picks across the agencies
beforeEach(async () => {
  await admin.query(`update media set status = 'ready' where status = 'processing'`)
})

test('a HEIC becomes a JPEG without GPS, and the original is gone', async () => {
  const a = await agency()
  const id = await waiting(a, await imageFixture('photo.heic'), 'heic')
  const d = deps()
  await wake(d, a, id)

  const media = await row(id)
  expect(media).toMatchObject({
    status: 'ready',
    storage_key: null,
    failure: null,
    width: 480,
    height: 320,
    progress: { step: 'ready', percent: 100 },
  })
  expect(media?.checks?.fixes.map((f) => f.code)).toEqual(
    expect.arrayContaining(['convert_to_jpeg', 'strip_metadata']),
  )
  expect(await runtime.storage.get(`org/${a.org}/media/${id}/original.heic`)).toBeNull()
  const [feed, master, thumb] = await variants(id)
  expect(feed).toMatchObject({ purpose: 'ig_feed', mime: 'image/jpeg' })
  expect(feed?.public_token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  // the photo kept whole, for the crops of the editor: never public
  expect(master).toMatchObject({ purpose: 'master', mime: 'image/jpeg', public_token: null })
  expect(thumb).toMatchObject({ purpose: 'thumbnail', mime: 'image/jpeg', public_token: null })
  const info = await imageInfo(await readFile(await local(feed?.storage_key ?? '', 'feed.jpg')))
  expect(info).toMatchObject({ format: 'jpeg', exif: false })
  const kept = await imageInfo(await readFile(await local(master?.storage_key ?? '', 'master.jpg')))
  expect(kept).toMatchObject({ format: 'jpeg', exif: false, width: 480, height: 320 })
})

test('a large photo: 1440 px to publish, up to 4096 px kept without GPS, all counted', async () => {
  const a = await agency()
  const big = await jpegOfSizeWithGps(6000, 4000)
  const id = await waiting(a, big, 'jpg')
  await wake(deps(), a, id)
  expect(await row(id)).toMatchObject({ status: 'ready', storage_key: null })
  const all = await variants(id)
  const by = (purpose: string) => all.find((v) => v.purpose === purpose)
  const feed = await imageInfo(
    await readFile(await local(by('ig_feed')?.storage_key ?? '', 'f.jpg')),
  )
  expect(feed).toMatchObject({ width: 1440, height: 960 })
  const master = by('master')
  const kept = await imageInfo(await readFile(await local(master?.storage_key ?? '', 'm.jpg')))
  expect(kept).toMatchObject({ format: 'jpeg', exif: false, width: 4096, height: 2731 })
  expect(master?.public_token).toBeNull()
  // the space counts the copy kept as any other
  const used = await runtime.uow.run({ organizationId: a.org, userId: null }, (tx) =>
    tx.media.storageUsed(a.org, a.workspace),
  )
  expect(used.workspace).toBe(all.reduce((n, v) => n + Number(v.size_bytes), 0))
})

test('a PNG in Display P3 becomes sRGB', async () => {
  const a = await agency()
  const id = await waiting(a, await displayP3Png(), 'png')
  await wake(deps(), a, id)
  const media = await row(id)
  expect(media?.status).toBe('ready')
  expect(media?.checks?.fixes.map((f) => f.code)).toEqual(
    expect.arrayContaining(['convert_to_jpeg', 'convert_to_srgb']),
  )
  const [feed] = await variants(id)
  const pixel = await firstPixel(await readFile(await local(feed?.storage_key ?? '', 'p3.jpg')))
  expect(pixel.icc).toBe(false)
  expect(Math.abs((pixel.rgb[0] ?? 0) - 200)).toBeLessThanOrEqual(4)
})

test('an HEVC MOV: the H.264 preview first, then the copy to publish', async () => {
  const a = await agency()
  const id = await waiting(a, await video('hevc.mov'), 'mov')
  const calls: Calls = { names: [] }
  await wake(deps(tools({ calls })), a, id)

  expect(calls.names[0]).toBe('videoPreview')
  expect(calls.names).toEqual(['videoPreview', 'videoRemux', 'videoFrame'])
  const media = await row(id)
  expect(media).toMatchObject({ status: 'ready', video_codec: 'hevc', duration_ms: 1000 })
  // a video keeps its original, never served by /m/*
  expect(media?.storage_key).toBe(`org/${a.org}/media/${id}/original.mov`)
  const rows = await variants(id)
  expect(rows.map((v) => [v.purpose, v.public_token !== null])).toEqual([
    ['preview', false],
    ['reel', true],
    ['thumbnail', false],
  ])
  const preview = probeFile(await local(rows[0]?.storage_key ?? '', 'preview.mp4'))
  expect(preview.streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('h264')
  const reel = probeFile(await local(rows[1]?.storage_key ?? '', 'reel.mp4'))
  expect(reel.streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('hevc')
})

test('an MP4 without faststart is remuxed without encoding again', async () => {
  const a = await agency()
  const bytes = await video('h264-moov-end.mp4')
  const id = await waiting(a, bytes, 'mp4')
  await wake(deps(), a, id)
  const media = await row(id)
  expect(media?.status).toBe('ready')
  expect(media?.checks?.fixes.map((f) => f.code)).toContain('faststart')
  const reel = (await variants(id)).find((v) => v.purpose === 'reel')
  const out = await readFile(await local(reel?.storage_key ?? '', 'faststart.mp4'))
  // the index first now, the place gone, the same codecs
  expect(out.indexOf('moov')).toBeLessThan(out.indexOf('mdat'))
  expect(bytes.indexOf('moov')).toBeGreaterThan(bytes.indexOf('mdat'))
  // the encoder's SEI message (where some cameras write a place) is gone from the stream
  expect(bytes.includes('x264 - core')).toBe(true)
  expect(out.includes('x264 - core')).toBe(false)
  const info = probeFile(join(dir, 'faststart.mp4'))
  expect(info.streams.map((s) => s.codec_name)).toEqual(['h264', 'aac'])
  expect(info.format.tags?.location).toBeUndefined()
})

test.each([
  ['a video of 1000 s in its header', 'long.mp4', 'too_long'],
  ['a video of 4200×4200 in its header', 'huge.mp4', 'too_many_pixels'],
] as const)('%s is failed without decoding', async (_label, name, code) => {
  const a = await agency()
  const id = await waiting(a, await video(name), 'mp4')
  const calls: Calls = { names: [] }
  await wake(deps(tools({ calls })), a, id)
  expect(calls.names).toEqual([])
  expect(await row(id)).toMatchObject({ status: 'failed', failure: { code } })
  expect(await variants(id)).toEqual([])
})

test('a small PNG declaring enormous dimensions is failed without decoding', async () => {
  const a = await agency()
  const id = await waiting(a, pngBomb(100_000, 100_000), 'png')
  const calls: Calls = { names: [] }
  await wake(deps(tools({ calls })), a, id)
  expect(calls.names).toEqual([])
  expect(await row(id)).toMatchObject({
    status: 'failed',
    failure: { code: 'too_many_pixels', limit: 50_000_000 },
    width: 100_000,
  })
})

test('a playlist named .mp4 is failed, reading neither files nor the network', async () => {
  const a = await agency()
  const plain = await waiting(a, hlsPlaylist(url), 'mp4')
  await wake(deps(), a, plain)
  expect(await row(plain)).toMatchObject({
    status: 'failed',
    failure: { code: 'unsupported_type' },
  })
  const dressed = await waiting(a, hlsBehindFtyp(url), 'mp4')
  await wake(deps(), a, dressed)
  expect(await row(dressed)).toMatchObject({ status: 'failed', failure: { code: 'unreadable' } })
  expect(hits).toBe(0)
})

test('a broken HEIC is failed with its reason, and leaves nothing', async () => {
  const a = await agency()
  const heic = await imageFixture('photo.heic')
  const id = await waiting(a, heic.subarray(0, Math.floor(heic.length * 0.6)), 'heic')
  await wake(deps(), a, id)
  expect(await row(id)).toMatchObject({
    status: 'failed',
    failure: { code: 'unreadable' },
    storage_key: null,
  })
  expect(await variants(id)).toEqual([])
  // a refusal is final: the original goes, with its GPS, and frees its space (§15.7)
  expect(await runtime.storage.list(`org/${a.org}/media/${id}/`)).toEqual([])
})

test('a file blocked before decoding loses its original too', async () => {
  const a = await agency()
  const id = await waiting(a, pngBomb(100_000, 100_000), 'png')
  await wake(deps(), a, id)
  expect(await row(id)).toMatchObject({ status: 'failed', storage_key: null })
  expect(await runtime.storage.list(`org/${a.org}/media/${id}/`)).toEqual([])
})

test('a conversion over its time keeps the original: a slow server is not the file', async () => {
  const a = await agency()
  const id = await waiting(a, await imageFixture('photo.png'), 'png')
  const real = tools()
  const slow = {
    ...real,
    transformer: {
      ...real.transformer,
      photo: () => Promise.resolve({ ok: false as const, reason: 'timeout' as const }),
    },
  }
  await wake(deps(slow), a, id)
  expect(await row(id)).toMatchObject({ status: 'failed', failure: { code: 'timeout' } })
  expect((await row(id))?.storage_key).not.toBeNull()
  expect(await runtime.storage.list(`org/${a.org}/media/${id}/`)).toHaveLength(1)
})

test('a copy made again gets a new id, so browsers and Meta do not keep the old one', async () => {
  const a = await agency()
  const id = await waiting(a, await video('hevc.mov'), 'mov')
  await wake(deps(), a, id)
  const first = await variants(id)
  expect(first.length).toBeGreaterThan(0)
  // made again, as after a worker stopped halfway
  await admin.query(`update media set status = 'processing' where id = $1`, [id])
  await wake(deps(), a, id, 'again')
  const again = await variants(id)
  expect(again.map((v) => v.purpose)).toEqual(first.map((v) => v.purpose))
  for (const v of again) expect(first.map((f) => f.id)).not.toContain(v.id)
})

test('two agencies: the second does not wait for all the files of the first', async () => {
  const a = await agency()
  const b = await agency()
  const photo = await imageFixture('photo.png')
  const ofA = [
    await waiting(a, photo, 'png'),
    await waiting(a, photo, 'png'),
    await waiting(a, photo, 'png'),
  ]
  // B's file comes after all of A's
  const ofB = await waiting(b, photo, 'png')
  const d = deps()
  for (let i = 0; i < 4; i += 1) await wake(d, a, ofA[0] ?? '', `turn-${String(i)}`)
  const processed = await admin.query<{ id: string }>(
    'select id from media where id = any($1) order by processing_started_at',
    [[...ofA, ofB]],
  )
  const ids = processed.rows.map((r) => r.id)
  // B is served first or right after A's first file; A's files go oldest first
  expect(ids.indexOf(ofB)).toBeLessThanOrEqual(1)
  expect(ids.filter((id) => id !== ofB)).toEqual(ofA)
  for (const id of ids) expect((await row(id))?.status).toBe('ready')
})

test('each wake-up processes one file and wakes the next', async () => {
  const a = await agency()
  const photo = await imageFixture('photo.png')
  const first = await waiting(a, photo, 'png')
  const next = await waiting(a, photo, 'png')
  const d = deps()
  await wake(d, a, first, 'job-1')
  expect((await row(first))?.status).toBe('ready')
  expect((await row(next))?.status).toBe('processing')
  expect(d.queue.sent).toEqual([
    {
      name: 'media.process',
      data: { organizationId: a.org, mediaId: next },
      opts: { dedupeKey: 'after:job-1' },
    },
  ])
  await wake(d, a, next, 'job-2')
  expect((await row(next))?.status).toBe('ready')
  // nothing waits any more: no wake-up
  expect(d.queue.sent).toHaveLength(1)
})

test('two workers: one conversion at a time', async () => {
  const a = await agency()
  const photo = await imageFixture('photo.png')
  const one = await waiting(a, photo, 'png')
  const two = await waiting(a, photo, 'png')
  let running = 0
  let most = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const around = async () => {
    running += 1
    most = Math.max(most, running)
    await gate
    running -= 1
  }
  // two processes: two pools, the lock is the database's
  const d1 = deps(tools({ around }))
  const d2 = deps(tools({ around, pool: second.pool }))
  const first = wake(d1, a, one, 'w1')
  await expect.poll(() => running).toBe(1)
  // the second worker finds the lock taken and leaves at once
  await wake(d2, a, two, 'w2')
  expect(running).toBe(1)
  release()
  await first
  expect(most).toBe(1)
  expect((await row(one))?.status).toBe('ready')
  expect((await row(two))?.status).toBe('processing')
  // the holder woke the file left
  expect(d1.queue.sent.map((s) => s.data)).toEqual([{ organizationId: a.org, mediaId: two }])
})

test('copies over the space left: failed with the reason, the copies go', async () => {
  const a = await agency()
  const bytes = await video('hevc.mov')
  const id = await waiting(a, bytes, 'mov')
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update organizations set limits = $2 where id = $1', [
      a.org,
      { storage_bytes: bytes.length + 10 },
    ]),
  )
  await wake(deps(), a, id)
  expect(await row(id)).toMatchObject({
    status: 'failed',
    failure: { code: 'storage_full', scope: 'organization', limit: bytes.length + 10 },
  })
  expect(await variants(id)).toEqual([])
  expect(await row(id)).toMatchObject({ storage_key: null })
  expect(await runtime.storage.list(`org/${a.org}/media/${id}/`)).toEqual([])
})

test('a file deleted while it is processed leaves no copy behind', async () => {
  const a = await agency()
  const id = await waiting(a, await video('hevc.mov'), 'mov')
  const around = async (name: string) => {
    if (name === 'videoRemux')
      await admin.query(`update media set status = 'deleted', deleted_at = now() where id = $1`, [
        id,
      ])
  }
  await wake(deps(tools({ around })), a, id)
  expect((await row(id))?.status).toBe('deleted')
  expect(await variants(id)).toEqual([])
  expect(await runtime.storage.list(`org/${a.org}/media/${id}/`)).toEqual([])
})

test('a file the worker keeps stopping on is failed after three attempts', async () => {
  const a = await agency()
  const id = await waiting(a, await imageFixture('photo.png'), 'png')
  await admin.query('update media set processing_attempts = 3 where id = $1', [id])
  const calls: Calls = { names: [] }
  await wake(deps(tools({ calls })), a, id)
  expect(calls.names).toEqual([])
  expect(await row(id)).toMatchObject({
    status: 'failed',
    failure: { code: 'processing_failed' },
    processing_attempts: 4,
  })
  // the fault may be ours: the original stays, to try again one day
  expect((await row(id))?.storage_key).not.toBeNull()
  expect(await runtime.storage.list(`org/${a.org}/media/${id}/`)).toHaveLength(1)
})

test('a wake-up with nothing waiting does nothing', async () => {
  const a = await agency()
  const d = deps()
  await wake(d, a, '00000000-0000-7000-8000-000000000000')
  expect(d.queue.sent).toEqual([])
})

test('an agency served a moment ago waits for one never served, whatever the age of its files', async () => {
  const a = await agency()
  const b = await agency()
  const photo = await imageFixture('photo.png')
  const older = await waiting(a, photo, 'png')
  const newer = await waiting(b, photo, 'png')
  // A had a file processed a moment ago
  const done = await waiting(a, photo, 'png')
  await admin.query(
    `update media set status = 'ready', processing_started_at = now() where id = $1`,
    [done],
  )
  await wake(deps(), a, older, 'served-1')
  expect((await row(newer))?.status).toBe('ready')
  expect((await row(older))?.status).toBe('processing')
})

test('a passing failure is retried and does not count against the file', async () => {
  const a = await agency()
  const id = await waiting(a, await imageFixture('photo.png'), 'png')
  const d = deps()
  const failing = {
    ...runtime.storage,
    put: () => Promise.reject(new Error('storage unreachable')),
  }
  await expect(
    mediaProcess(
      { id: 'flaky', data: { organizationId: a.org, mediaId: id } },
      { ...d, storage: failing },
    ),
  ).rejects.toThrow('storage unreachable')
  expect(await row(id)).toMatchObject({ status: 'processing', processing_attempts: 0 })
  // the next file is still woken after the failure
  expect(d.queue.sent.map((s) => s.data)).toEqual([{ organizationId: a.org, mediaId: id }])
  await wake(d, a, id, 'retry')
  expect(await row(id)).toMatchObject({ status: 'ready', processing_attempts: 1 })
})
