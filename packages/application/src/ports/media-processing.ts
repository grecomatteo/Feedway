import type { FileAnalysis, RecipeBox, ReelPlan } from '@app/domain'

// The worker's tools for the files (plan 04 Task 10). Paths are opaque: they come from
// `MediaScratch` and go back to the tools, never from input. A file the tools refuse is an
// answer (`ok: false`), never an exception: only what may pass by itself (disk full, a lost
// connection) throws, so the queue retries it.

/** A folder of the worker's own for one file, on the media volume (never the memory). */
export interface ScratchFolder {
  /** Writes `body` to a new file of the folder; `name` is a constant of the caller. */
  write(name: string, body: AsyncIterable<Uint8Array>): Promise<string>
  /** Where a tool may write a file of the folder. */
  path(name: string): string
  read(path: string): AsyncIterable<Uint8Array>
  size(path: string): Promise<number>
  /** Removes the folder; idempotent. */
  dispose(): Promise<void>
}

export interface MediaScratch {
  open(): Promise<ScratchFolder>
  /** Removes folders older than `ms`: a worker that died left them. */
  sweep(ms: number): Promise<number>
}

/** Why a tool refused a file, or stopped. `aborted`: the job's own signal. */
export type ToolRefusal = 'unreadable' | 'timeout' | 'aborted'

export type ToolResult<T> = ({ ok: true } & T) | { ok: false; reason: ToolRefusal }

export interface ToolOptions {
  signal?: AbortSignal | undefined
}

/**
 * What the file is, from its bytes: type, size, pixels and, for a video, duration and codecs,
 * read from the header (ffprobe, sharp) without decoding anything, so a file over the limits
 * costs nothing. `unknown`: no type Feedway takes.
 */
export interface MediaProbe {
  analyze(path: string, opts: ToolOptions): Promise<ToolResult<{ analysis: FileAnalysis }>>
}

export interface MadeFile {
  path: string
  mime: string
  sizeBytes: number
  width: number
  height: number
}

export interface MediaTransformer {
  /**
   * The photo to publish (spec §9.2): JPEG, sRGB, no metadata with the orientation applied, at
   * most `maxWidth` wide and `maxBytes` heavy. Decodes the whole image: this is where broken
   * bytes show.
   */
  photo(
    input: string,
    output: string,
    opts: ToolOptions & {
      format: 'jpeg' | 'png' | 'webp' | 'heic'
      maxWidth: number
      maxBytes: number
      maxPixels: number
      /**
       * For a copy to publish (plan 07 Task 6), from a JPEG in sRGB the transformer made (the
       * master, a frame): the box kept, in fractions of the picture (D-61); bands at the centre
       * to `pad.ratio` (width over height); the most it may be tall.
       */
      crop?: RecipeBox | undefined
      pad?: { ratio: number; background: 'white' | 'black' } | undefined
      maxHeight?: number | undefined
    },
  ): Promise<ToolResult<{ file: MadeFile }>>
  /**
   * The photo kept for the editor: JPEG in sRGB, upright, no metadata (no GPS), at most
   * `maxSide` on its long side. Decoding it whole validates it, as `photo` does.
   */
  master(
    input: string,
    output: string,
    opts: ToolOptions & {
      format: 'jpeg' | 'png' | 'webp' | 'heic'
      maxSide: number
      maxPixels: number
    },
  ): Promise<ToolResult<{ file: MadeFile }>>
  /** A small JPEG of a JPEG the transformer made. */
  thumbnail(
    input: string,
    output: string,
    opts: ToolOptions,
  ): Promise<ToolResult<{ file: MadeFile }>>
  /**
   * The panel's copy of a video (§11.1 point 7): MP4, H.264 at 720p, AAC, `faststart`.
   * `onProgress` gets 0–1 while it runs.
   */
  videoPreview(
    input: string,
    output: string,
    opts: ToolOptions & {
      width: number
      height: number
      durationMs: number
      /** with the size, sets the timeout (D-39) */
      fps: number
      onProgress?: (fraction: number) => void
    },
  ): Promise<ToolResult<{ file: MadeFile }>>
  /**
   * The video to publish as a reel (D-40): MP4 with `faststart`, no metadata. The streams Meta
   * takes are copied as they are; the others are converted (`plan` says which and why).
   * `onProgress` gets 0–1 while a conversion runs.
   */
  videoReel(
    input: string,
    output: string,
    opts: ToolOptions & {
      videoCodec: string
      durationMs: number
      sizeBytes: number
      width: number
      height: number
      fps: number
      onProgress?: (fraction: number) => void
    },
  ): Promise<ToolResult<{ file: MadeFile; plan: ReelPlan }>>
  /**
   * A video to publish converted from the original (plan 07 Task 6): H.264 and AAC in MP4 with
   * `faststart`, no metadata, 23–60 fps, SDR. `pad`: in the 9:16 frame with black bands;
   * `crop`: the 9:16 box at the centre; `convert`: its own proportions, inside 1080×1920.
   * `trimMs` cuts it there; `maxBytes` lowers the bitrate so it stays under.
   */
  videoFit(
    input: string,
    output: string,
    opts: ToolOptions & {
      fit: 'pad' | 'crop' | 'convert'
      width: number
      height: number
      durationMs: number
      sizeBytes: number
      fps: number
      trimMs: number | null
      maxBytes: number | null
      onProgress?: (fraction: number) => void
    },
  ): Promise<ToolResult<{ file: MadeFile }>>
  /**
   * One frame of the original video at `atMs`, upright, at its size, HDR made SDR: a JPEG in
   * sRGB for `photo` to frame as a reel's cover (D-60). Past the last frame: `unreadable`.
   */
  videoStill(
    input: string,
    output: string,
    opts: ToolOptions & {
      atMs: number
      width: number
      height: number
      durationMs: number
      sizeBytes: number
      fps: number
    },
  ): Promise<ToolResult<{ file: MadeFile }>>
  /** A JPEG of one frame, at `atMs`, of a video the transformer made. */
  videoFrame(
    input: string,
    output: string,
    opts: ToolOptions & { atMs: number; width: number; height: number },
  ): Promise<ToolResult<{ file: MadeFile }>>
}

/**
 * A lock for the whole installation, held while `fn` runs (Postgres advisory lock on a
 * connection of its own). `acquired: false`: someone holds it, and `fn` did not run.
 */
export interface ExclusiveLock {
  tryRun<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }>
}
