import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { imageFixture, jpegWithGps } from '../images/test-images.js'
import { moovBeforeMdat } from './mp4-boxes.js'
import { createMediaTools } from './media-tools.js'
import { iccDescription } from './images.js'
import {
  displayP3Png,
  hlsBehindFtyp,
  hlsPlaylist,
  makeDamagedVideo,
  makeResolutionSwitch,
  makeVideo,
  pngBomb,
  probeFile,
} from './test-media.js'

// The worker's tools against real files (plan 04 Task 10): ffprobe, ffmpeg and sharp with the
// armour of the plan. The handler's tests (apps/worker) go through the same tools.

const { probe, transformer } = createMediaTools()
let dir: string
let server: Server
let hits = 0
let url: string

const file = async (name: string, bytes: Buffer) => {
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'media-tools-'))
  // counts any request: a playlist must never reach it
  server = createServer((_req, res) => {
    hits += 1
    res.end('#EXTM3U\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('analysis', () => {
  test('a JPEG with GPS: its size, sRGB without a profile, metadata found', async () => {
    const path = await file('photo.jpg', await imageFixture('photo.jpg'))
    const probed = await probe.analyze(path, {})
    expect(probed).toMatchObject({
      ok: true,
      analysis: { kind: 'image', format: 'jpeg', width: 600, height: 400, hasMetadata: true },
    })
  })

  test('a PNG in Display P3 is not sRGB', async () => {
    const path = await file('p3.png', await displayP3Png())
    expect(await probe.analyze(path, {})).toMatchObject({
      ok: true,
      analysis: { format: 'png', colorSpace: 'other' },
    })
  })

  test('a PNG of a few bytes declaring 100000×100000 is read from its header only', async () => {
    const path = await file('bomb.png', pngBomb(100_000, 100_000))
    const started = Date.now()
    expect(await probe.analyze(path, {})).toMatchObject({
      ok: true,
      analysis: { kind: 'image', width: 100_000, height: 100_000 },
    })
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('a HEIC is read from its container, without decoding', async () => {
    const path = await file('photo.heic', await imageFixture('photo.heic'))
    expect(await probe.analyze(path, {})).toMatchObject({
      ok: true,
      analysis: { kind: 'image', format: 'heic', width: 480, height: 320, hasMetadata: true },
    })
  })

  test('a video: duration, fps, codecs and where its index is', async () => {
    const path = makeVideo(dir, 'h264-moov-end.mp4')
    expect(await probe.analyze(path, {})).toMatchObject({
      ok: true,
      analysis: {
        kind: 'video',
        format: 'mp4',
        width: 320,
        height: 240,
        durationMs: 2000,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        faststart: false,
      },
    })
  })

  test('an HEVC MOV, no sound', async () => {
    const path = makeVideo(dir, 'hevc.mov')
    expect(await probe.analyze(path, {})).toMatchObject({
      ok: true,
      analysis: { kind: 'video', format: 'mov', videoCodec: 'hevc', audioCodec: null },
    })
  })

  test('an enormous duration or size is read from the header, in an instant', async () => {
    for (const name of ['long.mp4', 'huge.mp4'] as const) {
      const path = makeVideo(dir, name)
      const started = Date.now()
      const probed = await probe.analyze(path, {})
      expect(Date.now() - started).toBeLessThan(5_000)
      expect(probed).toMatchObject({ ok: true, analysis: { kind: 'video' } })
    }
    expect(await probe.analyze(join(dir, 'long.mp4'), {})).toMatchObject({
      analysis: { durationMs: 1_000_000 },
    })
    expect(await probe.analyze(join(dir, 'huge.mp4'), {})).toMatchObject({
      analysis: { width: 4200, height: 4200 },
    })
  })

  test('a playlist named .mp4 is no type, and reads neither files nor the network', async () => {
    const plain = await file('playlist.mp4', hlsPlaylist(url))
    expect(await probe.analyze(plain, {})).toMatchObject({
      ok: true,
      analysis: { kind: 'unknown' },
    })
    // behind an `ftyp` the type check passes: the forced demuxer refuses it
    const dressed = await file('dressed.mp4', hlsBehindFtyp(url))
    expect(await probe.analyze(dressed, {})).toEqual({ ok: false, reason: 'unreadable' })
    const out = join(dir, 'dressed-preview.mp4')
    expect(
      await transformer.videoPreview(dressed, out, { width: 320, height: 240, durationMs: 1000 }),
    ).toEqual({ ok: false, reason: 'unreadable' })
    expect(hits).toBe(0)
  })

  test('the job signal stops the analysis', async () => {
    const path = makeVideo(dir, 'hevc.mov')
    expect(await probe.analyze(path, { signal: AbortSignal.abort() })).toEqual({
      ok: false,
      reason: 'aborted',
    })
  })
})

describe('photos', () => {
  test('a HEIC becomes a JPEG without GPS nor device', async () => {
    const path = await file('in.heic', await imageFixture('photo.heic'))
    const out = join(dir, 'heic.jpg')
    const made = await transformer.photo(path, out, {
      format: 'heic',
      maxWidth: 1440,
      maxBytes: 8_000_000,
      maxPixels: 50_000_000,
    })
    expect(made).toMatchObject({ ok: true, file: { mime: 'image/jpeg', width: 480, height: 320 } })
    const meta = await sharp(await readFile(out)).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(meta.xmp).toBeUndefined()
  })

  test('a PNG in Display P3 becomes sRGB: the colour is converted, not relabelled', async () => {
    const source = await displayP3Png()
    // the stored values are P3's
    const stored = await sharp(source).keepIccProfile().raw().toBuffer()
    expect(Math.abs((stored[0] ?? 0) - 200)).toBeGreaterThan(5)
    const out = join(dir, 'p3.jpg')
    const made = await transformer.photo(await file('p3-in.png', source), out, {
      format: 'png',
      maxWidth: 1440,
      maxBytes: 8_000_000,
      maxPixels: 50_000_000,
    })
    expect(made.ok).toBe(true)
    const meta = await sharp(out).metadata()
    expect(meta.icc).toBeUndefined()
    const pixel = await sharp(out).raw().toBuffer()
    expect(Math.abs((pixel[0] ?? 0) - 200)).toBeLessThanOrEqual(4)
    expect(Math.abs((pixel[1] ?? 0) - 80)).toBeLessThanOrEqual(4)
    expect(Math.abs((pixel[2] ?? 0) - 60)).toBeLessThanOrEqual(4)
  })

  test('a JPEG turned by its EXIF stays turned once the EXIF is gone', async () => {
    const path = await file('turned.jpg', await jpegWithGps({ orientation: 6 }))
    const out = join(dir, 'turned-out.jpg')
    const made = await transformer.photo(path, out, {
      format: 'jpeg',
      maxWidth: 1440,
      maxBytes: 8_000_000,
      maxPixels: 50_000_000,
    })
    // 600×400 turned a quarter
    expect(made).toMatchObject({ ok: true, file: { width: 400, height: 600 } })
    const meta = await sharp(out).metadata()
    expect(meta.orientation).toBeUndefined()
    expect(meta.exif).toBeUndefined()
  })

  test('wider than 1440 is resized; heavier than the limit is recompressed', async () => {
    const noisy = await sharp(
      Buffer.alloc(3000 * 2000 * 3).map(() => Math.floor(Math.random() * 256)),
      {
        raw: { width: 3000, height: 2000, channels: 3 },
      },
    )
      .png()
      .toBuffer()
    const out = join(dir, 'big.jpg')
    const made = await transformer.photo(await file('big.png', noisy), out, {
      format: 'png',
      maxWidth: 1440,
      maxBytes: 400_000,
      maxPixels: 50_000_000,
    })
    expect(made).toMatchObject({ ok: true, file: { width: 1440, height: 960 } })
    if (made.ok) expect(made.file.sizeBytes).toBeLessThanOrEqual(400_000)
  })

  test('a broken HEIC is refused by the decoder', async () => {
    const heic = await imageFixture('photo.heic')
    // the container stays, the picture's data is cut
    const broken = heic.subarray(0, Math.floor(heic.length * 0.6))
    const path = await file('broken.heic', broken)
    const made = await transformer.photo(path, join(dir, 'broken.jpg'), {
      format: 'heic',
      maxWidth: 1440,
      maxBytes: 8_000_000,
      maxPixels: 50_000_000,
    })
    expect(made).toEqual({ ok: false, reason: 'unreadable' })
  })

  test('the PNG bomb is refused by the decoder too, over the pixel limit', async () => {
    const path = await file('bomb2.png', pngBomb(100_000, 100_000))
    const made = await transformer.photo(path, join(dir, 'bomb.jpg'), {
      format: 'png',
      maxWidth: 1440,
      maxBytes: 8_000_000,
      maxPixels: 50_000_000,
    })
    expect(made).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('videos', () => {
  test('an HEVC MOV gets an H.264 preview that plays everywhere, with faststart', async () => {
    const path = makeVideo(dir, 'hevc.mov')
    const out = join(dir, 'preview.mp4')
    const fractions: number[] = []
    const made = await transformer.videoPreview(path, out, {
      width: 320,
      height: 240,
      durationMs: 1000,
      onProgress: (f) => fractions.push(f),
    })
    expect(made).toMatchObject({ ok: true, file: { mime: 'video/mp4', width: 320, height: 240 } })
    const info = probeFile(out)
    expect(info.format.format_name).toContain('mp4')
    expect(info.streams.find((s) => s.codec_type === 'video')).toMatchObject({
      codec_name: 'h264',
      width: 320,
      height: 240,
    })
    expect(await moovBeforeMdat(out)).toBe(true)
    expect(fractions.length).toBeGreaterThan(0)
  })

  test('an MP4 without faststart is remuxed without encoding again, and loses its place', async () => {
    const path = makeVideo(dir, 'h264-moov-end.mp4')
    expect(probeFile(path).format.tags?.location).toBeDefined()
    const out = join(dir, 'reel.mp4')
    const made = await transformer.videoRemux(path, out, {
      videoCodec: 'h264',
      durationMs: 2000,
      width: 320,
      height: 240,
    })
    expect(made.ok).toBe(true)
    expect(await moovBeforeMdat(out)).toBe(true)
    const before = probeFile(path)
    const after = probeFile(out)
    expect(after.streams.map((s) => s.codec_name)).toEqual(before.streams.map((s) => s.codec_name))
    expect(after.format.tags?.location).toBeUndefined()
    // the same encoded frames: a copy, not an encoding
    // the same pictures, frame by frame: a copy, not an encoding
    expect(frameHashes(out)).toEqual(frameHashes(path))
  })

  test('an HEVC remux keeps the hvc1 tag Apple and Meta read', async () => {
    const path = makeVideo(dir, 'hevc.mov')
    const out = join(dir, 'reel-hevc.mp4')
    expect(
      (
        await transformer.videoRemux(path, out, {
          videoCodec: 'hevc',
          durationMs: 1000,
          width: 320,
          height: 240,
        })
      ).ok,
    ).toBe(true)
    expect(ffprobeField(out, 'stream=codec_tag_string')).toEqual(['hvc1'])
  })

  test('a frame of the preview becomes the thumbnail', async () => {
    const path = makeVideo(dir, 'hevc.mov')
    const preview = join(dir, 'frame-preview.mp4')
    await transformer.videoPreview(path, preview, { width: 320, height: 240, durationMs: 1000 })
    const out = join(dir, 'frame.jpg')
    const made = await transformer.videoFrame(preview, out, { atMs: 500, width: 240, height: 180 })
    expect(made).toMatchObject({ ok: true, file: { mime: 'image/jpeg', width: 240, height: 180 } })
    expect((await sharp(out).metadata()).format).toBe('jpeg')
  })
})

/** One field of the video stream, per line of ffprobe's output. */
function ffprobeField(path: string, entries: string): string[] {
  return execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', path],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
}

/** The md5 of every decoded frame of the video. */
const frameHashes = (path: string) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:v:0', '-f', 'framemd5', '-'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim())

test('frames larger than the header said are refused by the decoder', async () => {
  const path = makeResolutionSwitch(dir, '320x240', '640x480')
  const limited = createMediaTools({ maxVideoPixels: 320 * 240 })
  // the header shows only the first, small frames
  expect(await limited.probe.analyze(path, {})).toMatchObject({
    ok: true,
    analysis: { width: 320, height: 240 },
  })
  expect(
    await limited.transformer.videoPreview(path, join(dir, 'switch-preview.mp4'), {
      width: 320,
      height: 240,
      durationMs: 2000,
    }),
  ).toEqual({ ok: false, reason: 'unreadable' })
})

test('a video with a glitch the decoder hides is kept: every frame is still there', async () => {
  const path = makeDamagedVideo(dir)
  const tools = createMediaTools()
  const probed = await tools.probe.analyze(path, {})
  expect(probed).toMatchObject({ ok: true, analysis: { kind: 'video' } })
  const preview = await tools.transformer.videoPreview(path, join(dir, 'damaged-preview.mp4'), {
    width: 320,
    height: 240,
    durationMs: 4000,
  })
  expect(preview).toMatchObject({ ok: true })
  expect(Number(probeFile(join(dir, 'damaged-preview.mp4')).format.duration)).toBeCloseTo(4, 0)
})

test('a malformed ICC profile is no description, never an error', () => {
  const icc = Buffer.alloc(200)
  icc.writeUInt32BE(1, 128)
  icc.write('desc', 132, 'latin1')
  icc.writeUInt32BE(150, 136)
  icc.writeUInt32BE(48, 140)
  icc.write('mluc', 150, 'latin1')
  // an odd length of UTF-16
  icc.writeUInt32BE(7, 170)
  icc.writeUInt32BE(28, 174)
  expect(() => iccDescription(icc)).not.toThrow()
  expect(iccDescription(Buffer.alloc(10))).toBeNull()
})
