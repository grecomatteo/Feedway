import type { FileBlock, FileFix, FileWarning } from './check-file.js'

// The worker's processing of a file (plan 04 Task 10, ADR 021): what it makes and how long a
// command may take.

/** Why a file is `failed`: a block of §9.2, or what the worker found. Never retried. */
export type MediaFailure =
  | FileBlock
  /** the decoder refused the bytes: broken, or not what the header says */
  | { code: 'unreadable' }
  /** a command ran past its time */
  | { code: 'timeout' }
  /** the copies do not fit in the space left */
  | { code: 'storage_full'; scope: 'organization' | 'workspace'; limit: number }
  /** the worker stopped on this file again and again (MEDIA_PROCESS_MAX_ATTEMPTS) */
  | { code: 'processing_failed' }

/** What Feedway did to the file and what it proposes: the panel says it (§9.2). */
export interface MediaChecks {
  fixes: FileFix[]
  warnings: FileWarning[]
}

/** The steps of the job, as the panel shows them (§14.2: «Analisi → Conversione → Pronto»). */
export const MEDIA_STEPS = ['analysis', 'conversion', 'ready'] as const
export type MediaStep = (typeof MEDIA_STEPS)[number]

/** A file picked this many times without an end is `failed`: it may be what stops the worker. */
export const MEDIA_PROCESS_MAX_ATTEMPTS = 3

const FFMPEG_TIMEOUT_BASE_MS = 2 * 60_000
export const FFMPEG_TIMEOUT_MAX_MS = 60 * 60_000

/** ADR 021: 2 minutes plus 4 times the duration, at most 60 minutes (a reel of 15 minutes). */
export const ffmpegTimeoutMs = (durationMs: number) =>
  Math.min(FFMPEG_TIMEOUT_BASE_MS + 4 * Math.max(0, durationMs), FFMPEG_TIMEOUT_MAX_MS)

/**
 * Seconds of work allowed for each second of video, per pixel per second: 4K at 60 fps (about
 * 500 million pixels a second) gets 50 s per second, twice what one core of the VPS needed in
 * the 0.10.0 test (D-39). Never less than the 4 of `ffmpegTimeoutMs`.
 */
const WORK_SECONDS_PER_PIXEL = 1 / 10_000_000

/**
 * The timeout of a command that decodes the video (the preview): 2 minutes plus the duration
 * times its pixels per second, at most 60 minutes like `ffmpegTimeoutMs`.
 */
export function videoWorkTimeoutMs(v: {
  durationMs: number
  width: number
  height: number
  fps: number
}): number {
  const factor = Math.max(4, v.width * v.height * v.fps * WORK_SECONDS_PER_PIXEL)
  return Math.min(
    FFMPEG_TIMEOUT_BASE_MS + factor * Math.max(0, v.durationMs),
    FFMPEG_TIMEOUT_MAX_MS,
  )
}

/**
 * pg-boss's expiry of `media.process`: longer than the two long commands of a media, the
 * preview and the copy to publish, at their longest (ADR 021: 2 hours and 15 minutes).
 */
export const MEDIA_PROCESS_EXPIRE_SECONDS = 2 * 3600 + 15 * 60

/** A command that only reads a header (ffprobe) or a photo. */
export const PROBE_TIMEOUT_MS = 60_000

export const PREVIEW_SHORT_SIDE = 720
export const THUMBNAIL_LONG_SIDE = 480

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

/** The preview's size: 720 on the short side (never more than the file), both sides even. */
export function previewSize(width: number, height: number): { width: number; height: number } {
  const short = Math.min(width, height)
  const scale = short > PREVIEW_SHORT_SIDE ? PREVIEW_SHORT_SIDE / short : 1
  return { width: even(width * scale), height: even(height * scale) }
}

/** The thumbnail's size: 480 on the long side, never enlarged. */
export function thumbnailSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height)
  const scale = long > THUMBNAIL_LONG_SIDE ? THUMBNAIL_LONG_SIDE / long : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const PUBLISHABLE_VIDEO_CODECS = new Set(['h264', 'hevc'])

/**
 * Whether the video can be published without converting it (plan 04, Scelta 6): otherwise the
 * conversion is a choice for the editor (stage 6), and the file has no copy to publish yet.
 */
export const isPublishableVideo = (v: { videoCodec: string; audioCodec: string | null }) =>
  PUBLISHABLE_VIDEO_CODECS.has(v.videoCodec) && (v.audioCodec === null || v.audioCodec === 'aac')
