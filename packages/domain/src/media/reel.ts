// The copy of a video to publish as a reel (D-40): copied as it is when Meta takes it, otherwise
// converted. Limits read on 2026-11-17 in Meta's documentation: Instagram «IG User Media, Reel
// Specifications» (at most 1920 columns, VBR at most 25 Mbit/s, 23–60 fps, 4:2:0, AAC at most
// 48 kHz in mono or stereo) and Facebook «Reels Publishing API» (1080×1920 recommended, 24–60
// fps, fixed frame rate). Not yet tried on a real account (stage 7), nor are the edit lists
// ffmpeg may write in the MP4 (Instagram asks for none): D-40.

export const REEL_MAX_LONG_SIDE = 1920
export const REEL_MAX_SHORT_SIDE = 1080
/** Instagram's most, in bits per second, over the whole file: the sound counts too. */
export const REEL_MAX_BITRATE = 25_000_000
export const REEL_MAX_FPS = 60
export const REEL_AUDIO_MAX_SAMPLE_RATE = 48_000
export const REEL_AUDIO_MAX_CHANNELS = 2
/** 4:2:0, in 8 or 10 bit: what phones film and Meta lists. */
const REEL_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p', 'yuv420p10le'])

/** The conversion: H.264 High, around 10 Mbit/s and never over 12, AAC at 128 kbit/s. */
export const REEL_ENCODE = {
  videoBitrate: 10_000_000,
  maxBitrate: 12_000_000,
  audioBitrate: 128_000,
  sampleRate: 48_000,
  /** a closed GOP every 2 seconds: Facebook asks for 2 to 5 */
  gopSeconds: 2,
} as const

/** What the worker reads of a video to choose (ffprobe, header only). */
export interface ReelSource {
  /** as the picture is shown, turned */
  width: number
  height: number
  durationMs: number
  sizeBytes: number
  /** the average frame rate */
  fps: number
  constantFrameRate: boolean
  /** ffprobe's `pix_fmt` */
  pixelFormat: string
  /** PQ or HLG: a converted copy is made SDR, or its colours look washed out */
  hdr: boolean
  /** AAC only: another codec is a choice for the editor (§9.2), with no copy to publish */
  audio: { sampleRate: number; channels: number } | null
}

export type ReelReason = 'size' | 'bitrate' | 'frame_rate' | 'pixel_format' | 'audio'

export interface ReelPlan {
  video:
    | { mode: 'copy' }
    | { mode: 'encode'; width: number; height: number; fps: number; toneMap: boolean }
  audio: 'copy' | 'encode' | 'none'
  /** why it is not a plain copy; empty for a copy */
  reasons: ReelReason[]
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

/** The size of a converted reel: inside 1080×1920 either way round, never enlarged. */
export function reelSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const scale = Math.min(1, REEL_MAX_LONG_SIDE / long, REEL_MAX_SHORT_SIDE / short)
  return { width: even(width * scale), height: even(height * scale) }
}

export function reelPlan(source: ReelSource): ReelPlan {
  const reasons: ReelReason[] = []
  if (Math.max(source.width, source.height) > REEL_MAX_LONG_SIDE) reasons.push('size')
  const seconds = source.durationMs / 1000
  if (seconds > 0 && (source.sizeBytes * 8) / seconds > REEL_MAX_BITRATE) reasons.push('bitrate')
  if (source.fps > REEL_MAX_FPS || !source.constantFrameRate) reasons.push('frame_rate')
  if (!REEL_PIXEL_FORMATS.has(source.pixelFormat)) reasons.push('pixel_format')

  const audio: ReelPlan['audio'] =
    source.audio === null
      ? 'none'
      : source.audio.sampleRate <= REEL_AUDIO_MAX_SAMPLE_RATE &&
          source.audio.channels <= REEL_AUDIO_MAX_CHANNELS
        ? 'copy'
        : 'encode'
  if (audio === 'encode') reasons.push('audio')

  const encodeVideo = reasons.some((r) => r !== 'audio')
  return {
    video: encodeVideo
      ? {
          mode: 'encode',
          ...reelSize(source.width, source.height),
          fps: Math.min(source.fps, REEL_MAX_FPS),
          toneMap: source.hdr,
        }
      : { mode: 'copy' },
    audio,
    reasons,
  }
}
