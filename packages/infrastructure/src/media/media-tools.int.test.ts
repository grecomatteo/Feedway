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
      await transformer.videoPreview(dressed, out, {
        width: 320,
        height: 240,
        durationMs: 1000,
        fps: 25,
      }),
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

  test('a HEIC in Display P3 becomes sRGB, the master too (D-03)', async () => {
    // an iPhone photo: P3 values for sRGB 200/80/60, with the profile in the container
    const path = await file('p3.heic', await imageFixture('photo-p3.heic'))
    for (const make of ['photo', 'master'] as const) {
      const out = join(dir, `p3-heic-${make}.jpg`)
      const made =
        make === 'photo'
          ? await transformer.photo(path, out, {
              format: 'heic',
              maxWidth: 1440,
              maxBytes: 8_000_000,
              maxPixels: 50_000_000,
            })
          : await transformer.master(path, out, {
              format: 'heic',
              maxSide: 4096,
              maxPixels: 50_000_000,
            })
      expect(made.ok).toBe(true)
      expect((await sharp(out).metadata()).icc).toBeUndefined()
      const pixel = await sharp(out).raw().toBuffer()
      expect(Math.abs((pixel[0] ?? 0) - 200)).toBeLessThanOrEqual(5)
      expect(Math.abs((pixel[1] ?? 0) - 80)).toBeLessThanOrEqual(5)
      expect(Math.abs((pixel[2] ?? 0) - 60)).toBeLessThanOrEqual(5)
    }
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
      fps: 25,
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

  /** The reel of a fixture, with what the analysis says of it. */
  async function reelOf(name: Parameters<typeof makeVideo>[1], out: string) {
    const path = makeVideo(dir, name)
    const probed = await probe.analyze(path, {})
    if (!probed.ok || probed.analysis.kind !== 'video') throw new Error(`${name} not a video`)
    const { analysis } = probed
    const fractions: number[] = []
    const made = await transformer.videoReel(path, join(dir, out), {
      videoCodec: analysis.videoCodec,
      durationMs: analysis.durationMs,
      sizeBytes: analysis.sizeBytes,
      width: analysis.width,
      height: analysis.height,
      fps: analysis.fps,
      onProgress: (f) => fractions.push(f),
    })
    return { path, out: join(dir, out), made, fractions }
  }

  test('an MP4 without faststart is remuxed without encoding again, and loses its place', async () => {
    expect(probeFile(makeVideo(dir, 'h264-moov-end.mp4')).format.tags?.location).toBeDefined()
    const { path, out, made } = await reelOf('h264-moov-end.mp4', 'reel.mp4')
    expect(made).toMatchObject({
      ok: true,
      file: { width: 320, height: 240 },
      plan: { video: { mode: 'copy' }, audio: 'copy', reasons: [] },
    })
    expect(await moovBeforeMdat(out)).toBe(true)
    const before = probeFile(path)
    const after = probeFile(out)
    expect(after.streams.map((s) => s.codec_name)).toEqual(before.streams.map((s) => s.codec_name))
    expect(after.format.tags?.location).toBeUndefined()
    // the same pictures, frame by frame: a copy, not an encoding
    expect(frameHashes(out)).toEqual(frameHashes(path))
  })

  test('an HEVC remux keeps the hvc1 tag Apple and Meta read', async () => {
    const { out, made } = await reelOf('hevc.mov', 'reel-hevc.mp4')
    expect(made).toMatchObject({ ok: true, plan: { video: { mode: 'copy' } } })
    expect(ffprobeField(out, 'stream=codec_tag_string')).toEqual(['hvc1'])
  })

  test('a 4K video becomes 1080×1920 H.264 High inside the limits of Reels (D-40)', async () => {
    const { out, made, fractions } = await reelOf('4k-portrait.mp4', 'reel-4k.mp4')
    expect(made).toMatchObject({
      ok: true,
      file: { mime: 'video/mp4', width: 1080, height: 1920 },
      plan: { video: { mode: 'encode', width: 1080, height: 1920, fps: 30 }, audio: 'copy' },
    })
    expect(ffprobeField(out, 'stream=codec_name,profile,width,height,pix_fmt')).toEqual([
      'h264,High,1080,1920,yuv420p',
    ])
    expect(ffprobeField(out, 'stream=r_frame_rate,avg_frame_rate')).toEqual(['30/1,30/1'])
    expect(audioField(out, 'stream=codec_name,sample_rate')).toEqual(['aac,48000'])
    expect(await moovBeforeMdat(out)).toBe(true)
    expect(fractions.length).toBeGreaterThan(0)
  })

  test('an HDR video converted for Reels comes out SDR, so its colours are not washed out', async () => {
    const { out, made } = await reelOf('hdr-hlg.mov', 'reel-hdr.mp4')
    expect(made).toMatchObject({ ok: true, plan: { video: { mode: 'encode', toneMap: true } } })
    expect(ffprobeField(out, 'stream=codec_name,pix_fmt,color_transfer,color_primaries')).toEqual([
      'h264,yuv420p,bt709,bt709',
    ])
  })

  test('sound at 96 kHz in 6 channels is encoded again, the pictures are copied', async () => {
    const { path, out, made } = await reelOf('audio-96k.mp4', 'reel-96k.mp4')
    expect(made).toMatchObject({
      ok: true,
      plan: { video: { mode: 'copy' }, audio: 'encode', reasons: ['audio'] },
    })
    expect(audioField(out, 'stream=codec_name,sample_rate,channels')).toEqual(['aac,48000,2'])
    expect(frameHashes(out)).toEqual(frameHashes(path))
  })

  test('a frame rate that is not fixed is made fixed, as Facebook asks', async () => {
    const { out, made } = await reelOf('vfr.mp4', 'reel-vfr.mp4')
    expect(made).toMatchObject({
      ok: true,
      plan: { video: { mode: 'encode' }, reasons: ['frame_rate'] },
    })
    const [rates] = ffprobeField(out, 'stream=r_frame_rate,avg_frame_rate')
    const [r, avg] = (rates ?? '').split(',')
    expect(r).toBe(avg)
  })

  test('a frame of the preview becomes the thumbnail', async () => {
    const path = makeVideo(dir, 'hevc.mov')
    const preview = join(dir, 'frame-preview.mp4')
    await transformer.videoPreview(path, preview, {
      width: 320,
      height: 240,
      durationMs: 1000,
      fps: 25,
    })
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

/** One field of the sound stream, per line of ffprobe's output. */
function audioField(path: string, entries: string): string[] {
  return execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', entries, '-of', 'csv=p=0', path],
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
      fps: 25,
    }),
  ).toEqual({ ok: false, reason: 'unreadable' })
})

test('frames over the limit are refused even when a sound track keeps the full length', async () => {
  const path = makeResolutionSwitch(dir, '320x240', '640x480', { audio: true })
  const limited = createMediaTools({ maxVideoPixels: 320 * 240 })
  expect(
    await limited.transformer.videoPreview(path, join(dir, 'switch-audio-preview.mp4'), {
      width: 320,
      height: 240,
      durationMs: 2000,
      fps: 25,
    }),
  ).toEqual({ ok: false, reason: 'unreadable' })
})

test('frames over the limit in the middle are refused', async () => {
  const path = makeResolutionSwitch(dir, '320x240', '640x480', { then: '320x240' })
  const limited = createMediaTools({ maxVideoPixels: 320 * 240 })
  expect(
    await limited.transformer.videoPreview(path, join(dir, 'switch-middle-preview.mp4'), {
      width: 320,
      height: 240,
      durationMs: 3000,
      fps: 25,
    }),
  ).toEqual({ ok: false, reason: 'unreadable' })
})

test('one frame over the limit among a hundred is refused: no share of them is allowed', async () => {
  const path = makeResolutionSwitch(dir, '320x240', '640x480', {
    then: '320x240',
    smallSeconds: 5,
    largeFrames: 1,
  })
  const limited = createMediaTools({ maxVideoPixels: 320 * 240 })
  expect(
    await limited.transformer.videoPreview(path, join(dir, 'switch-few-preview.mp4'), {
      width: 320,
      height: 240,
      durationMs: 10_100,
      fps: 25,
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
    fps: 25,
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
