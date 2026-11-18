import { expect, test } from 'vitest'
import { frameAt, lastFrameMs, publishedFps, stepFrames } from './cover.js'

test('the frame rate is the published copy’s: 30 when the worker converts it', () => {
  expect(publishedFps(59.94)).toBe(59.94)
  expect(publishedFps(120, [{ code: 'convert_fps', fps: 30 }])).toBe(30)
  expect(publishedFps(20, [{ code: 'convert_codec' }, { code: 'convert_fps' }])).toBe(30)
  expect(publishedFps(null)).toBeNull()
  expect(publishedFps(0)).toBeNull()
})

test('the cursor ends on the last true frame', () => {
  // 18 s at 30 fps: the last frame starts at 17 966.67 ms, rounded down to the ms (Scelta 4)
  expect(lastFrameMs(18_000, 30)).toBe(17_966)
  expect(frameAt(lastFrameMs(18_000, 30), 30)).toBe(538)
  // 10 s at 59.94 fps
  expect(lastFrameMs(10_000, 59.94)).toBe(9983)
  expect(frameAt(lastFrameMs(10_000, 59.94), 59.94)).toBe(598)
  expect(lastFrameMs(0, 30)).toBe(0)
})

test('one frame at a time, at 30 and at 59.94 fps, never out of the video', () => {
  const at30 = { durationMs: 18_000, fps: 30 }
  expect(stepFrames(0, 1, at30)).toBe(34)
  expect(frameAt(stepFrames(0, 1, at30), 30)).toBe(1)
  expect(stepFrames(34, -1, at30)).toBe(0)
  expect(stepFrames(0, -1, at30)).toBe(0)
  expect(stepFrames(17_966, 1, at30)).toBe(17_966)
  // a second is 30 frames
  expect(frameAt(stepFrames(1000, 30, at30), 30)).toBe(60)
  const at5994 = { durationMs: 10_000, fps: 59.94 }
  let at = 0
  for (let i = 0; i < 100; i++) at = stepFrames(at, 1, at5994)
  expect(frameAt(at, 59.94)).toBe(100)
  for (let i = 0; i < 100; i++) at = stepFrames(at, -1, at5994)
  expect(at).toBe(0)
  expect(stepFrames(9983, 1, at5994)).toBe(9983)
})
