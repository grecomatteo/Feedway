// The «File» checks of spec §9.2, for every place that judges a file: the worker after the
// upload (plan 04 Task 10) and the post checks of stage 5. Pure: the analysis comes from the
// bytes (sharp, ffprobe), never from the name or the declared type.

export type FileAnalysis =
  /** The bytes are no type Feedway takes. */
  | { kind: 'unknown'; sizeBytes: number }
  | {
      kind: 'image'
      format: 'jpeg' | 'png' | 'webp' | 'heic'
      sizeBytes: number
      width: number
      height: number
      /** null: no colour profile, read as sRGB */
      colorSpace: 'srgb' | 'other' | null
      /** EXIF, GPS, device: anything but the pixels */
      hasMetadata: boolean
    }
  | {
      kind: 'video'
      format: 'mp4' | 'mov'
      sizeBytes: number
      width: number
      height: number
      durationMs: number
      fps: number
      /** ffprobe's codec names, e.g. `h264`, `hevc`, `aac` */
      videoCodec: string
      /** null: no sound */
      audioCodec: string | null
      /** the moov atom comes before the data */
      faststart: boolean
    }

/** The upload limits of the installation (MEDIA_MAX_*). */
export interface FileLimits {
  maxImageBytes: number
  maxImagePixels: number
  maxVideoBytes: number
  maxVideoSeconds: number
  maxVideoPixels: number
}

export type FileBlock =
  | { code: 'unsupported_type' }
  | { code: 'too_large'; limit: number }
  | { code: 'too_many_pixels'; limit: number }
  | { code: 'too_long'; limitSeconds: number }

export type FileFix =
  | { code: 'convert_to_jpeg' }
  | { code: 'convert_to_srgb' }
  | { code: 'strip_metadata' }
  | { code: 'recompress'; platform: 'instagram' | 'facebook'; limit: number }
  | { code: 'resize'; width: number }
  | { code: 'faststart' }

export type FileWarning = { code: 'convert_codec' } | { code: 'convert_fps'; fps: number }

export interface FileCheck {
  /** Not usable: nothing else is done to the file. */
  blocks: FileBlock[]
  /** Done by Feedway, and said. */
  fixes: FileFix[]
  /** A choice for the person, with the conversion proposed. */
  warnings: FileWarning[]
}

/** Meta's limits for a photo (§9.2), in decimal megabytes: the lower reading of "8 MB". */
export const INSTAGRAM_PHOTO_MAX_BYTES = 8_000_000
export const FACEBOOK_PHOTO_MAX_BYTES = 4_000_000
export const PHOTO_MAX_WIDTH = 1440
const VIDEO_CODECS = ['h264', 'hevc']
const AUDIO_CODECS = ['aac']
const FPS_RANGE = { min: 23, max: 60, proposed: 30 }

function blocksOf(a: FileAnalysis, limits: FileLimits): FileBlock[] {
  if (a.kind === 'unknown') return [{ code: 'unsupported_type' }]
  const blocks: FileBlock[] = []
  const maxBytes = a.kind === 'image' ? limits.maxImageBytes : limits.maxVideoBytes
  if (a.sizeBytes > maxBytes) blocks.push({ code: 'too_large', limit: maxBytes })
  const maxPixels = a.kind === 'image' ? limits.maxImagePixels : limits.maxVideoPixels
  if (a.width * a.height > maxPixels) blocks.push({ code: 'too_many_pixels', limit: maxPixels })
  if (a.kind === 'video' && a.durationMs > limits.maxVideoSeconds * 1000)
    blocks.push({ code: 'too_long', limitSeconds: limits.maxVideoSeconds })
  return blocks
}

export function checkFile(analysis: FileAnalysis, limits: FileLimits): FileCheck {
  const blocks = blocksOf(analysis, limits)
  if (blocks.length > 0 || analysis.kind === 'unknown') return { blocks, fixes: [], warnings: [] }
  const fixes: FileFix[] = []
  const warnings: FileWarning[] = []
  if (analysis.kind === 'image') {
    if (analysis.format !== 'jpeg') fixes.push({ code: 'convert_to_jpeg' })
    if (analysis.colorSpace === 'other') fixes.push({ code: 'convert_to_srgb' })
    if (analysis.hasMetadata) fixes.push({ code: 'strip_metadata' })
    if (analysis.sizeBytes > INSTAGRAM_PHOTO_MAX_BYTES)
      fixes.push({ code: 'recompress', platform: 'instagram', limit: INSTAGRAM_PHOTO_MAX_BYTES })
    if (analysis.sizeBytes > FACEBOOK_PHOTO_MAX_BYTES)
      fixes.push({ code: 'recompress', platform: 'facebook', limit: FACEBOOK_PHOTO_MAX_BYTES })
    if (analysis.width > PHOTO_MAX_WIDTH) fixes.push({ code: 'resize', width: PHOTO_MAX_WIDTH })
  } else {
    const audioOk = analysis.audioCodec === null || AUDIO_CODECS.includes(analysis.audioCodec)
    if (!VIDEO_CODECS.includes(analysis.videoCodec) || !audioOk)
      warnings.push({ code: 'convert_codec' })
    if (analysis.fps < FPS_RANGE.min || analysis.fps > FPS_RANGE.max)
      warnings.push({ code: 'convert_fps', fps: FPS_RANGE.proposed })
    if (!analysis.faststart) fixes.push({ code: 'faststart' })
  }
  return { blocks, fixes, warnings }
}
