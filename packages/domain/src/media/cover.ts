import type { FileWarning } from './check-file.js'

// The reel's cover chosen as a frame (plan 06 Task 6, Scelta 4, D-60): the frames are those of
// the copy that is published, so the cursor stops on the last true frame.

/**
 * The frame rate of the copy that is published: the one the worker converts to when it proposes
 * it (`convert_fps`), otherwise the original's. Null when unknown.
 */
export function publishedFps(
  fps: number | null,
  warnings: readonly Pick<FileWarning, 'code'>[] | readonly { code: string; fps?: unknown }[] = [],
): number | null {
  const convert = warnings.find((w) => w.code === 'convert_fps') as
    { code: string; fps?: unknown } | undefined
  if (convert) return typeof convert.fps === 'number' ? convert.fps : 30
  return fps !== null && fps > 0 ? fps : null
}

/** The last true frame of the video, in ms: `durationMs − 1000 / fps`, rounded down. */
export function lastFrameMs(durationMs: number, fps: number): number {
  if (durationMs <= 0 || fps <= 0) return 0
  return Math.max(0, Math.floor(durationMs - 1000 / fps))
}

/** The frame an offset falls in (0 the first), at that frame rate. */
export const frameAt = (offsetMs: number, fps: number) => Math.floor((offsetMs * fps) / 1000 + 1e-6)

/** The offset of a frame: its first millisecond, rounded up so it is inside the frame. */
export const frameStartMs = (frame: number, fps: number) => Math.ceil((frame * 1000) / fps - 1e-6)

/**
 * The offset `frames` frames away (negative: back), kept between 0 and the last true frame.
 * The offset lands at the start of its frame, so moving a frame and back again returns there.
 */
export function stepFrames(
  offsetMs: number,
  frames: number,
  video: { durationMs: number; fps: number },
): number {
  const last = lastFrameMs(video.durationMs, video.fps)
  const next = frameStartMs(frameAt(offsetMs, video.fps) + frames, video.fps)
  return Math.min(last, Math.max(0, next))
}
