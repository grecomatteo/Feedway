import { stat } from 'node:fs/promises'
import type { MadeFile, ToolResult } from '@app/application'
import {
  PROBE_TIMEOUT_MS,
  ffmpegTimeoutMs,
  previewSize,
  videoWorkTimeoutMs,
  type FileAnalysis,
} from '@app/domain'
import { moovBeforeMdat } from './mp4-boxes.js'
import { runTool, type ToolRun } from './run-tool.js'

// ffprobe and ffmpeg, armoured (plan 04, «ffmpeg blindato»): the container is already confirmed
// from the bytes (`ftyp`), the demuxer is forced to mov/mp4 and only the `file` protocol is
// allowed, so a playlist dressed as `.mp4` reads neither local files nor the network. Low
// priority and a timeout (ADR 021). The decoding commands take `threads` (one, as spec §16.6
// asks, unless Matteo gives the worker more CPU: D-39); the headers and the remux keep one.

export interface FfmpegCommands {
  ffmpeg: string
  ffprobe: string
}

type VideoAnalysis = Extract<FileAnalysis, { kind: 'video' }>

/**
 * The input options: forced demuxer, local files only, no external references, and the
 * decoder's own pixel limit: the header checked by §9.2 is only the first one, and a stream may
 * switch to far larger frames later (security review of Task 10).
 */
const inputWith =
  (maxPixels: number | null, threads = 1) =>
  (path: string) => [
    '-protocol_whitelist',
    'file',
    '-f',
    'mov',
    '-enable_drefs',
    '0',
    '-threads',
    String(threads),
    ...(maxPixels === null ? [] : ['-max_pixels', String(maxPixels)]),
    '-i',
    `file:${path}`,
  ]

/**
 * The decoder's refusal of a frame over `-max_pixels` (libavutil `av_image_check_size2`): such a
 * file is always refused, whatever else the copy holds, since the copy to publish takes its
 * frames as they are.
 */
const OVER_MAX_PIXELS = /exceeds specified max pixel count/
const global = (threads = 1) => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-filter_threads',
  String(threads),
]
const GLOBAL = global()

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

interface CountOutput {
  streams?: { nb_read_packets?: string }[]
}

interface ProbeOutput {
  streams?: ProbeStream[]
  format?: { duration?: string }
}

function rate(value: string | undefined): number | null {
  if (!value) return null
  const [num, den] = value.split('/').map(Number)
  if (num === undefined || !Number.isFinite(num) || num <= 0) return null
  const r = den === undefined ? num : den > 0 ? num / den : NaN
  return Number.isFinite(r) && r > 0 ? Math.round(r * 1000) / 1000 : null
}

/** A phone keeps the picture as filmed and says how to turn it: the panel sees it turned. */
function quarterTurned(stream: ProbeStream): boolean {
  const rotation =
    stream.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ??
    Number(stream.tags?.rotate ?? 0)
  return Math.abs(Math.round(rotation / 90)) % 2 === 1
}

const refusal = (run: ToolRun) =>
  ({ ok: false, reason: run.outcome === 'exited' ? 'unreadable' : run.outcome }) as const

export function createFfmpeg(
  commands: FfmpegCommands,
  limits: { maxVideoPixels: number; threads: number },
) {
  const input = inputWith(limits.maxVideoPixels)
  // the decoding commands: the preview decodes every frame of the original
  const decodeInput = inputWith(limits.maxVideoPixels, limits.threads)
  const threads = String(limits.threads)
  // ffprobe opens the decoder too: with the limit it would refuse what §9.2 must name
  const header = inputWith(null)
  /** Header only: nothing is decoded, so an enormous duration or size costs nothing. */
  async function probeVideo(
    path: string,
    format: 'mp4' | 'mov',
    signal?: AbortSignal,
  ): Promise<ToolResult<{ analysis: VideoAnalysis }>> {
    const run = await runTool(
      commands.ffprobe,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...header(path),
        // whole sections: the names of single entries changed between ffmpeg versions
        '-show_streams',
        '-show_format',
        '-of',
        'json',
      ],
      { timeoutMs: PROBE_TIMEOUT_MS, signal },
    )
    if (run.outcome !== 'exited' || run.code !== 0) return refusal(run)
    let out: ProbeOutput
    try {
      out = JSON.parse(run.stdout) as ProbeOutput
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
    const video = out.streams?.find((s) => s.codec_type === 'video')
    const audio = out.streams?.find((s) => s.codec_type === 'audio')
    const durationMs = Math.round(Number(out.format?.duration) * 1000)
    const fps = rate(video?.avg_frame_rate) ?? rate(video?.r_frame_rate)
    if (
      !video?.codec_name ||
      !video.width ||
      !video.height ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      fps === null
    )
      return { ok: false, reason: 'unreadable' }
    const turned = quarterTurned(video)
    return {
      ok: true,
      analysis: {
        kind: 'video',
        format,
        sizeBytes: (await stat(path)).size,
        width: turned ? video.height : video.width,
        height: turned ? video.width : video.height,
        durationMs,
        fps,
        videoCodec: video.codec_name,
        audioCodec: audio?.codec_name ?? null,
        faststart: await moovBeforeMdat(path),
      },
    }
  }

  /**
   * The video frames the file holds, counted from its packets (nothing decoded): a sound track or
   * a header cannot stretch this number, unlike the container's duration.
   */
  async function videoPackets(path: string, signal?: AbortSignal): Promise<number | null> {
    const run = await runTool(
      commands.ffprobe,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...header(path),
        '-select_streams',
        'v:0',
        '-count_packets',
        '-show_streams',
        '-of',
        'json',
      ],
      { timeoutMs: PROBE_TIMEOUT_MS, signal },
    )
    if (run.outcome !== 'exited' || run.code !== 0) return null
    try {
      const packets = Number((JSON.parse(run.stdout) as CountOutput).streams?.[0]?.nb_read_packets)
      return Number.isFinite(packets) && packets > 0 ? packets : null
    } catch {
      return null
    }
  }

  async function made(
    run: ToolRun,
    output: string,
    file: Omit<MadeFile, 'sizeBytes' | 'path'>,
  ): Promise<ToolResult<{ file: MadeFile }>> {
    if (run.outcome !== 'exited' || run.code !== 0) {
      // a full disk passes by itself: the job is retried
      if (/No space left on device/i.test(run.stderr)) throw new Error('media work disk is full')
      return refusal(run)
    }
    return { ok: true, file: { ...file, path: output, sizeBytes: (await stat(output)).size } }
  }

  return {
    probeVideo,

    /** H.264 at 720p and AAC, `faststart`: plays in every browser (§11.1 point 7). */
    async preview(
      path: string,
      output: string,
      opts: {
        width: number
        height: number
        durationMs: number
        fps: number
        signal?: AbortSignal | undefined
        onProgress?: ((fraction: number) => void) | undefined
      },
    ) {
      const size = previewSize(opts.width, opts.height)
      // from `-progress`: frames written, and those of them the encoder repeated to fill a gap
      const progress = { frame: 0, dup: 0 }
      const run = await runTool(
        commands.ffmpeg,
        [
          ...global(limits.threads),
          ...decodeInput(path),
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-map_metadata',
          '-1',
          '-map_chapters',
          '-1',
          '-vf',
          `scale=${String(size.width)}:${String(size.height)},format=yuv420p`,
          '-c:v',
          'libx264',
          // the encoding at 720p costs little next to the decoding: the fastest preset that keeps
          // B-frames and CABAC
          '-preset',
          'superfast',
          '-crf',
          '26',
          '-profile:v',
          'high',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ac',
          '2',
          '-threads',
          threads,
          '-movflags',
          '+faststart',
          '-progress',
          'pipe:1',
          '-nostats',
          '-f',
          'mp4',
          '-y',
          `file:${output}`,
        ],
        {
          timeoutMs: videoWorkTimeoutMs(opts),
          signal: opts.signal,
          watchStderr: OVER_MAX_PIXELS,
          onLine: (line) => {
            const count = /^(frame|dup_frames)=(\d+)$/.exec(line)
            if (count?.[2]) progress[count[1] === 'frame' ? 'frame' : 'dup'] = Number(count[2])
            const match = /^out_time_us=(\d+)$/.exec(line)
            if (match?.[1] && opts.onProgress && opts.durationMs > 0)
              opts.onProgress(Math.min(1, Number(match[1]) / 1000 / opts.durationMs))
          },
        },
      )
      // at `-loglevel error` a clean file says nothing. A frame over the pixel limit refuses the
      // file. After any other error the copy must hold every frame of the file, counted (P6): a
      // glitch the decoder hid leaves them all, a broken stretch does not. Frames, not duration:
      // a sound track or a repeated frame keeps the length of a copy with holes
      if (run.outcome === 'exited' && run.code === 0 && run.stderr.trim() !== '') {
        if (run.stderrMatched) return { ok: false, reason: 'unreadable' } as const
        const frames = await videoPackets(path, opts.signal)
        if (frames === null || progress.frame - progress.dup < frames)
          return { ok: false, reason: 'unreadable' } as const
      }
      return made(run, output, { mime: 'video/mp4', ...size })
    },

    /** The same streams in MP4 with `faststart`, no metadata: no encoding (§16.6). */
    async remux(
      path: string,
      output: string,
      opts: {
        videoCodec: string
        width: number
        height: number
        durationMs: number
        signal?: AbortSignal | undefined
      },
    ) {
      const run = await runTool(
        commands.ffmpeg,
        [
          ...GLOBAL,
          ...input(path),
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c',
          'copy',
          // the place, the device and the dates go; the turn of the picture stays
          '-map_metadata',
          '-1',
          '-map_metadata:s:v',
          '-1',
          '-map_metadata:s:a',
          '-1',
          '-map_chapters',
          '-1',
          // H.264 SEI messages may carry a place or a time (drones, action cameras); HEVC's keep
          // the HDR information, so they stay (not verified on real cameras)
          ...(opts.videoCodec === 'h264' ? ['-bsf:v', 'filter_units=remove_types=6'] : []),
          ...(opts.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          '-y',
          `file:${output}`,
        ],
        { timeoutMs: ffmpegTimeoutMs(opts.durationMs), signal: opts.signal },
      )
      return made(run, output, { mime: 'video/mp4', width: opts.width, height: opts.height })
    },

    /** One frame as a JPEG, from a video ffmpeg made. */
    async frame(
      path: string,
      output: string,
      opts: { atMs: number; width: number; height: number; signal?: AbortSignal | undefined },
    ) {
      const run = await runTool(
        commands.ffmpeg,
        [
          ...GLOBAL,
          '-ss',
          (opts.atMs / 1000).toFixed(3),
          ...input(path),
          '-frames:v',
          '1',
          '-vf',
          `scale=${String(opts.width)}:${String(opts.height)}`,
          '-q:v',
          '3',
          '-threads',
          '1',
          '-f',
          'image2',
          '-c:v',
          'mjpeg',
          '-update',
          '1',
          '-y',
          `file:${output}`,
        ],
        { timeoutMs: PROBE_TIMEOUT_MS, signal: opts.signal },
      )
      return made(run, output, { mime: 'image/jpeg', width: opts.width, height: opts.height })
    },
  }
}
