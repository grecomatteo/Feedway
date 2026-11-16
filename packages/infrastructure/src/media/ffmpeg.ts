import { stat } from 'node:fs/promises'
import type { MadeFile, ToolResult } from '@app/application'
import { PROBE_TIMEOUT_MS, ffmpegTimeoutMs, previewSize, type FileAnalysis } from '@app/domain'
import { moovBeforeMdat } from './mp4-boxes.js'
import { runTool, type ToolRun } from './run-tool.js'

// ffprobe and ffmpeg, armoured (plan 04, «ffmpeg blindato»): the container is already confirmed
// from the bytes (`ftyp`), the demuxer is forced to mov/mp4 and only the `file` protocol is
// allowed, so a playlist dressed as `.mp4` reads neither local files nor the network. One
// thread, low priority, a timeout in proportion to the duration (ADR 021).

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
const inputWith = (maxPixels: number | null) => (path: string) => [
  '-protocol_whitelist',
  'file',
  '-f',
  'mov',
  '-enable_drefs',
  '0',
  '-threads',
  '1',
  ...(maxPixels === null ? [] : ['-max_pixels', String(maxPixels)]),
  '-i',
  `file:${path}`,
]

/** After a decoding error, the share of the declared duration the copy must keep. */
const DECODED_SHARE = 0.97
const GLOBAL = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-filter_threads', '1']

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

export function createFfmpeg(commands: FfmpegCommands, limits: { maxVideoPixels: number }) {
  const input = inputWith(limits.maxVideoPixels)
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
        signal?: AbortSignal | undefined
        onProgress?: ((fraction: number) => void) | undefined
      },
    ) {
      const size = previewSize(opts.width, opts.height)
      const run = await runTool(
        commands.ffmpeg,
        [
          ...GLOBAL,
          ...input(path),
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
          '-preset',
          'veryfast',
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
          '1',
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
          timeoutMs: ffmpegTimeoutMs(opts.durationMs),
          signal: opts.signal,
          onLine: (line) => {
            const match = /^out_time_us=(\d+)$/.exec(line)
            if (match?.[1] && opts.onProgress && opts.durationMs > 0)
              opts.onProgress(Math.min(1, Number(match[1]) / 1000 / opts.durationMs))
          },
        },
      )
      // at `-loglevel error` a clean file says nothing. Frames the decoder refused (over the
      // pixel limit, broken) leave a shorter copy with an exit code 0; a glitch it hid leaves
      // them all. So after an error the copy must last as long as the file says (P6)
      if (run.outcome === 'exited' && run.code === 0 && run.stderr.trim() !== '') {
        const copy = await probeVideo(output, 'mp4', opts.signal)
        if (!copy.ok || copy.analysis.durationMs < opts.durationMs * DECODED_SHARE)
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
