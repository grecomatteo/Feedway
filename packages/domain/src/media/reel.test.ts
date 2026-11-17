import { expect, test } from 'vitest'
import { reelPlan, reelSize, type ReelSource } from './reel.js'

// A 1080p iPhone clip that Meta takes as it is.
const fine: ReelSource = {
  width: 1080,
  height: 1920,
  durationMs: 20_000,
  sizeBytes: 25_000_000, // 10 Mbit/s
  fps: 30,
  constantFrameRate: true,
  pixelFormat: 'yuv420p',
  hdr: false,
  audio: { sampleRate: 44_100, channels: 2 },
}

test('a video inside the limits of Reels is copied as it is', () => {
  expect(reelPlan(fine)).toEqual({ video: { mode: 'copy' }, audio: 'copy', reasons: [] })
  expect(reelPlan({ ...fine, audio: null }).audio).toBe('none')
  // landscape 1920×1080 and 10 bit 4:2:0 are inside too
  expect(
    reelPlan({ ...fine, width: 1920, height: 1080, pixelFormat: 'yuv420p10le' }).video,
  ).toEqual({
    mode: 'copy',
  })
})

test('a 4K iPhone video at 36 Mbit/s is converted to 1080×1920 H.264 (D-40)', () => {
  const plan = reelPlan({
    ...fine,
    width: 2160,
    height: 3840,
    durationMs: 23_000,
    sizeBytes: 103_500_000, // 36 Mbit/s
    fps: 59.94,
  })
  expect(plan.video).toEqual({
    mode: 'encode',
    width: 1080,
    height: 1920,
    fps: 59.94,
    toneMap: false,
  })
  expect(plan.reasons).toEqual(['size', 'bitrate'])
  // the sound is fine: it is not encoded again
  expect(plan.audio).toBe('copy')
})

test('each limit of Meta on its own asks for the conversion', () => {
  const reasons = (s: Partial<ReelSource>) => reelPlan({ ...fine, ...s }).reasons
  expect(reasons({ width: 1440, height: 2560 })).toEqual(['size'])
  // 25 Mbit/s is the most Instagram takes
  expect(reasons({ sizeBytes: 62_500_000 })).toEqual([])
  expect(reasons({ sizeBytes: 62_500_001 })).toEqual(['bitrate'])
  expect(reasons({ fps: 120 })).toEqual(['frame_rate'])
  // Facebook asks for a fixed frame rate
  expect(reasons({ fps: 44, constantFrameRate: false })).toEqual(['frame_rate'])
  expect(reasons({ pixelFormat: 'yuv422p10le' })).toEqual(['pixel_format'])
  expect(reasons({ hdr: true })).toEqual([])
})

test('the sound alone is encoded again when Meta would not take it', () => {
  const sound = (audio: ReelSource['audio']) => reelPlan({ ...fine, audio })
  expect(sound({ sampleRate: 96_000, channels: 2 })).toEqual({
    video: { mode: 'copy' },
    audio: 'encode',
    reasons: ['audio'],
  })
  expect(sound({ sampleRate: 48_000, channels: 6 }).audio).toBe('encode')
  expect(sound({ sampleRate: 48_000, channels: 1 }).audio).toBe('copy')
})

test('the conversion keeps the frame rate up to 60 and makes it fixed', () => {
  const fps = (s: Partial<ReelSource>) => {
    const plan = reelPlan({ ...fine, ...s })
    return plan.video.mode === 'encode' ? plan.video.fps : null
  }
  expect(fps({ fps: 120 })).toBe(60)
  expect(fps({ fps: 44, constantFrameRate: false })).toBe(44)
  expect(fps({ fps: 29.97, width: 2160, height: 3840 })).toBe(29.97)
})

test('an HDR video becomes SDR only when it is converted', () => {
  const big = { ...fine, width: 2160, height: 3840, hdr: true }
  expect(reelPlan(big).video).toMatchObject({ mode: 'encode', toneMap: true })
  expect(reelPlan({ ...fine, hdr: true }).video).toEqual({ mode: 'copy' })
})

test('the converted size fits 1080×1920 either way, even, never enlarged', () => {
  expect(reelSize(2160, 3840)).toEqual({ width: 1080, height: 1920 })
  expect(reelSize(3840, 2160)).toEqual({ width: 1920, height: 1080 })
  expect(reelSize(2160, 2160)).toEqual({ width: 1080, height: 1080 })
  expect(reelSize(2160, 2700)).toEqual({ width: 1080, height: 1350 })
  expect(reelSize(1080, 1920)).toEqual({ width: 1080, height: 1920 })
  expect(reelSize(721, 1281)).toEqual({ width: 720, height: 1280 })
  // a very tall picture is bound by its long side
  expect(reelSize(1000, 4000)).toEqual({ width: 480, height: 1920 })
})
