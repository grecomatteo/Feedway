import { expect, test } from 'vitest'
import { checkFile, type FileAnalysis, type FileLimits } from './check-file.js'

// One case per row of the «File» table (spec §9.2), plus the upload limits that protect the
// worker (plan 04, Review Focus 1).

const LIMITS: FileLimits = {
  maxImageBytes: 50_000_000,
  maxImagePixels: 50_000_000,
  maxVideoBytes: 300_000_000,
  maxVideoSeconds: 900,
  maxVideoPixels: 4096 * 4096,
  photoMaxBytes: { instagram: 8_000_000, facebook: 4_000_000 },
}

/** A JPEG that needs nothing: sRGB, no metadata, 1080 px wide, 2 MB. */
const photo: FileAnalysis = {
  kind: 'image',
  format: 'jpeg',
  sizeBytes: 2_000_000,
  width: 1080,
  height: 1350,
  colorSpace: 'srgb',
  hasMetadata: false,
}

/** An MP4 that needs nothing: H.264 and AAC at 30 fps, `faststart`. */
const video: FileAnalysis = {
  kind: 'video',
  format: 'mp4',
  sizeBytes: 40_000_000,
  width: 1080,
  height: 1920,
  durationMs: 20_000,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  faststart: true,
}

const codes = (a: FileAnalysis) => {
  const r = checkFile(a, LIMITS)
  return {
    blocks: r.blocks.map((i) => i.code),
    fixes: r.fixes.map((i) => i.code),
    warnings: r.warnings.map((i) => i.code),
  }
}
const none = { blocks: [], fixes: [], warnings: [] }

test('a file that needs nothing has no block, fix or warning', () => {
  expect(codes(photo)).toEqual(none)
  expect(codes(video)).toEqual(none)
  // a video without sound is fine
  expect(codes({ ...video, audioCodec: null })).toEqual(none)
})

test('a type read from the bytes that is not supported blocks, and nothing else is said', () => {
  expect(codes({ kind: 'unknown', sizeBytes: 1000 })).toEqual({
    ...none,
    blocks: ['unsupported_type'],
  })
})

test('a photo over 50 megapixels blocks', () => {
  expect(codes({ ...photo, width: 8000, height: 6251 }).blocks).toEqual(['too_many_pixels'])
  expect(codes({ ...photo, width: 8000, height: 6250 }).blocks).toEqual([])
})

test('a file over the upload limits blocks', () => {
  expect(codes({ ...photo, sizeBytes: 50_000_001 }).blocks).toEqual(['too_large'])
  expect(checkFile({ ...photo, sizeBytes: 50_000_001 }, LIMITS).blocks[0]).toEqual({
    code: 'too_large',
    limit: 50_000_000,
  })
})

test('a video over 300 MB blocks', () => {
  expect(codes({ ...video, sizeBytes: 300_000_001 }).blocks).toEqual(['too_large'])
  expect(codes({ ...video, sizeBytes: 300_000_000 }).blocks).toEqual([])
})

test('a video too long or too large in pixels blocks, as declared by its container', () => {
  expect(codes({ ...video, durationMs: 900_001 }).blocks).toEqual(['too_long'])
  expect(codes({ ...video, width: 4097, height: 4096 }).blocks).toEqual(['too_many_pixels'])
})

test('a blocked file gets no fixes or warnings: nothing will be done to it', () => {
  expect(codes({ ...photo, format: 'heic', width: 9000, height: 9000 })).toEqual({
    ...none,
    blocks: ['too_many_pixels'],
  })
})

test.each(['heic', 'png', 'webp'] as const)('a %s photo is converted to JPEG', (format) => {
  expect(codes({ ...photo, format }).fixes).toEqual(['convert_to_jpeg'])
})

test('a colour profile other than sRGB is converted to sRGB', () => {
  expect(codes({ ...photo, colorSpace: 'other' }).fixes).toEqual(['convert_to_srgb'])
  // no profile at all is read as sRGB
  expect(codes({ ...photo, colorSpace: null }).fixes).toEqual([])
})

test('EXIF metadata is removed, the orientation kept', () => {
  expect(codes({ ...photo, hasMetadata: true }).fixes).toEqual(['strip_metadata'])
})

test('a photo over 8 MB is recompressed for Instagram, over 4 MB for Facebook', () => {
  expect(checkFile({ ...photo, sizeBytes: 8_000_001 }, LIMITS).fixes).toEqual([
    { code: 'recompress', platform: 'instagram', limit: 8_000_000 },
    { code: 'recompress', platform: 'facebook', limit: 4_000_000 },
  ])
  expect(checkFile({ ...photo, sizeBytes: 4_000_001 }, LIMITS).fixes).toEqual([
    { code: 'recompress', platform: 'facebook', limit: 4_000_000 },
  ])
  expect(codes({ ...photo, sizeBytes: 4_000_000 }).fixes).toEqual([])
})

test('a photo wider than 1440 px is resized', () => {
  expect(checkFile({ ...photo, width: 1441 }, LIMITS).fixes).toEqual([
    { code: 'resize', width: 1440 },
  ])
  expect(codes({ ...photo, width: 1440 }).fixes).toEqual([])
})

test('a video codec other than H.264 or HEVC, or audio other than AAC, warns', () => {
  expect(codes({ ...video, videoCodec: 'hevc' }).warnings).toEqual([])
  expect(codes({ ...video, videoCodec: 'vp9' }).warnings).toEqual(['convert_codec'])
  expect(codes({ ...video, audioCodec: 'opus' }).warnings).toEqual(['convert_codec'])
  // one warning for the two together: one conversion fixes both
  expect(codes({ ...video, videoCodec: 'vp9', audioCodec: 'opus' }).warnings).toEqual([
    'convert_codec',
  ])
})

test('fps outside 23–60 warns, with a conversion to 30 fps proposed', () => {
  expect(checkFile({ ...video, fps: 22.9 }, LIMITS).warnings).toEqual([
    { code: 'convert_fps', fps: 30 },
  ])
  expect(codes({ ...video, fps: 60.1 }).warnings).toEqual(['convert_fps'])
  expect(codes({ ...video, fps: 23 }).warnings).toEqual([])
  expect(codes({ ...video, fps: 60 }).warnings).toEqual([])
  // 23.976 of cinema cameras is inside
  expect(codes({ ...video, fps: 23.976 }).warnings).toEqual([])
})

test('a moov atom not at the start is remuxed with faststart, without loss', () => {
  expect(codes({ ...video, faststart: false }).fixes).toEqual(['faststart'])
  expect(codes({ ...video, format: 'mov', faststart: false }).fixes).toEqual(['faststart'])
})

test('the findings come in the order of the table', () => {
  expect(
    codes({
      ...photo,
      format: 'png',
      colorSpace: 'other',
      hasMetadata: true,
      width: 2000,
      sizeBytes: 9_000_000,
    }).fixes,
  ).toEqual([
    'convert_to_jpeg',
    'convert_to_srgb',
    'strip_metadata',
    'recompress',
    'recompress',
    'resize',
  ])
})
