import { open, stat } from 'node:fs/promises'
import type { MediaProbe, MediaTransformer } from '@app/application'
import { SNIFF_BYTES, sniffMedia } from '@app/domain'
import { createFfmpeg, type FfmpegCommands } from './ffmpeg.js'
import { createImageTools } from './images.js'

// The worker's MediaProbe and MediaTransformer (plan 04 Task 10): the type comes from the bytes
// (`sniffMedia`, the same reading as the upload), never from the name or the stored mime.

async function head(path: string): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await file.read(buffer, 0, SNIFF_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

export interface MediaToolsOptions {
  /** `ffmpeg` and `ffprobe` from PATH by default */
  commands?: Partial<FfmpegCommands>
  /** MEDIA_MAX_VIDEO_PIXELS: the decoder refuses larger frames, wherever they come in the stream */
  maxVideoPixels?: number
  /** ffmpeg's threads for the commands that decode a video; 2 by default, with the worker's 1.5 CPU (spec §16.6, D-39) */
  threads?: number
}

export function createMediaTools(options: MediaToolsOptions = {}): {
  probe: MediaProbe
  transformer: MediaTransformer
} {
  const ffmpeg = createFfmpeg(
    {
      ffmpeg: options.commands?.ffmpeg ?? 'ffmpeg',
      ffprobe: options.commands?.ffprobe ?? 'ffprobe',
    },
    { maxVideoPixels: options.maxVideoPixels ?? 4096 * 4096, threads: options.threads ?? 2 },
  )
  const images = createImageTools()
  const aborted = (signal?: AbortSignal) => signal?.aborted === true

  return {
    probe: {
      async analyze(path, opts) {
        if (aborted(opts.signal)) return { ok: false, reason: 'aborted' }
        const sniffed = sniffMedia(await head(path))
        if (!sniffed) {
          const { size } = await stat(path)
          return { ok: true, analysis: { kind: 'unknown', sizeBytes: size } }
        }
        if (sniffed.kind === 'video')
          return ffmpeg.probeVideo(path, sniffed.format as 'mp4' | 'mov', opts.signal)
        return images.probeImage(path, sniffed.format as 'jpeg' | 'png' | 'webp' | 'heic')
      },
    },
    transformer: {
      async photo(input, output, opts) {
        if (aborted(opts.signal)) return { ok: false, reason: 'aborted' }
        return images.photo(input, output, opts)
      },
      async master(input, output, opts) {
        if (aborted(opts.signal)) return { ok: false, reason: 'aborted' }
        return images.master(input, output, opts)
      },
      async thumbnail(input, output, opts) {
        if (aborted(opts.signal)) return { ok: false, reason: 'aborted' }
        return images.thumbnail(input, output)
      },
      videoPreview: (input, output, opts) => ffmpeg.preview(input, output, opts),
      videoReel: (input, output, opts) => ffmpeg.reel(input, output, opts),
      videoFrame: (input, output, opts) => ffmpeg.frame(input, output, opts),
      videoFit: (input, output, opts) => ffmpeg.fit(input, output, opts),
      videoStill: (input, output, opts) => ffmpeg.still(input, output, opts),
    },
  }
}
