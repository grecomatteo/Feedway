import { expect, test } from 'vitest'
import {
  FFMPEG_TIMEOUT_MAX_MS,
  MEDIA_PROCESS_EXPIRE_SECONDS,
  ffmpegTimeoutMs,
  videoWorkTimeoutMs,
  isPublishableVideo,
  previewSize,
  thumbnailSize,
} from './processing.js'

test('the ffmpeg timeout is 2 minutes plus 4 times the duration, at most 60 minutes', () => {
  expect(ffmpegTimeoutMs(0)).toBe(120_000)
  expect(ffmpegTimeoutMs(60_000)).toBe(120_000 + 240_000)
  // a reel of 15 minutes reaches the cap (ADR 021)
  expect(ffmpegTimeoutMs(15 * 60_000)).toBe(FFMPEG_TIMEOUT_MAX_MS)
  expect(ffmpegTimeoutMs(10 * 3_600_000)).toBe(FFMPEG_TIMEOUT_MAX_MS)
})

test('a decoded video has a timeout in proportion to its pixels per second (D-39)', () => {
  // the file of the 0.10.0 test: 4K at 60 fps, 23 s, needed about 10 minutes on one core
  const k4p60 = videoWorkTimeoutMs({ durationMs: 23_000, width: 2160, height: 3840, fps: 60 })
  expect(k4p60).toBeGreaterThan(15 * 60_000)
  // 1080p at 30 fps keeps at least the timeout by duration
  const hd = { durationMs: 60_000, width: 1080, height: 1920, fps: 30 }
  expect(videoWorkTimeoutMs(hd)).toBeGreaterThanOrEqual(ffmpegTimeoutMs(60_000))
  expect(videoWorkTimeoutMs({ ...hd, fps: 60 })).toBeGreaterThan(videoWorkTimeoutMs(hd))
  // a small video never goes under the timeout by duration
  expect(videoWorkTimeoutMs({ durationMs: 60_000, width: 640, height: 360, fps: 30 })).toBe(
    ffmpegTimeoutMs(60_000),
  )
  // the cap stays: the job's expiry is reckoned on it
  expect(videoWorkTimeoutMs({ durationMs: 900_000, width: 2160, height: 3840, fps: 60 })).toBe(
    FFMPEG_TIMEOUT_MAX_MS,
  )
})

test('the job outlives the two long commands of a media', () => {
  expect(MEDIA_PROCESS_EXPIRE_SECONDS * 1000).toBeGreaterThan(2 * FFMPEG_TIMEOUT_MAX_MS)
})

test('the preview is 720p on its short side, even, never enlarged', () => {
  expect(previewSize(1920, 1080)).toEqual({ width: 1280, height: 720 })
  expect(previewSize(1080, 1920)).toEqual({ width: 720, height: 1280 })
  expect(previewSize(640, 360)).toEqual({ width: 640, height: 360 })
  // odd sizes become even: H.264 in 4:2:0 asks for it
  expect(previewSize(321, 241)).toEqual({ width: 320, height: 240 })
  expect(previewSize(1000, 3000)).toEqual({ width: 720, height: 2160 })
})

test('the thumbnail fits 480 px on its long side', () => {
  expect(thumbnailSize(1440, 1800)).toEqual({ width: 384, height: 480 })
  expect(thumbnailSize(1920, 1080)).toEqual({ width: 480, height: 270 })
  expect(thumbnailSize(200, 100)).toEqual({ width: 200, height: 100 })
})

test('a video is published as it is only with H.264 or HEVC and AAC or no sound', () => {
  expect(isPublishableVideo({ videoCodec: 'h264', audioCodec: 'aac' })).toBe(true)
  expect(isPublishableVideo({ videoCodec: 'hevc', audioCodec: null })).toBe(true)
  expect(isPublishableVideo({ videoCodec: 'vp9', audioCodec: 'aac' })).toBe(false)
  expect(isPublishableVideo({ videoCodec: 'h264', audioCodec: 'pcm_s16le' })).toBe(false)
})
