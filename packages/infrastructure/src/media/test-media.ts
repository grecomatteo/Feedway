import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'

// Test files for the media tools (plan 04, Test): small, made here with ffmpeg and sharp, so the
// tests run with the ffmpeg of the machine (the image's in CI).

export type VideoFixture =
  /** H.264 and AAC, 2 s, 320×240, moov at the end (ffmpeg's default) */
  | 'h264-moov-end.mp4'
  /** HEVC tagged hvc1, as iPhones film it, no sound, 1 s */
  | 'hevc.mov'
  /** 1000 s at one frame per second, 16×16: over the 900 s of a reel */
  | 'long.mp4'
  /** one frame of 4200×4200: over the 4096×4096 limit */
  | 'huge.mp4'

const SOURCES: Record<VideoFixture, string[]> = {
  'h264-moov-end.mp4': [
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    // a place, as phones write it: the copies must not keep it
    '-metadata',
    'location=+45.4642+009.1900/',
  ],
  'hevc.mov': [
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=30',
    '-t',
    '1',
    '-c:v',
    'libx265',
    '-x265-params',
    'log-level=error',
    '-tag:v',
    'hvc1',
    '-pix_fmt',
    'yuv420p',
  ],
  'long.mp4': [
    '-f',
    'lavfi',
    '-i',
    'color=size=16x16:rate=1',
    '-t',
    '1000',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
  ],
  'huge.mp4': [
    '-f',
    'lavfi',
    '-i',
    'color=size=4200x4200:rate=1',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
  ],
}

/** Writes the video into `dir` and returns its path. */
export function makeVideo(dir: string, name: VideoFixture): string {
  const path = join(dir, name)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...SOURCES[name], path], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return path
}

/** ffprobe's view of a file, for the assertions. */
export function probeFile(path: string): {
  streams: { codec_type: string; codec_name: string; width?: number; height?: number }[]
  format: { format_name: string; duration?: string; tags?: Record<string, string> }
} {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    { encoding: 'utf8' },
  )
  return JSON.parse(out) as ReturnType<typeof probeFile>
}

/** A playlist dressed as `.mp4`: it names a local file and an address. */
export function hlsPlaylist(url: string): Buffer {
  return Buffer.from(
    [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:1',
      '#EXTINF:1,',
      `${url}/segment.ts`,
      '#EXTINF:1,',
      'file:///etc/passwd',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
  )
}

/** The same playlist behind an MP4 `ftyp` box: the type check passes, the demuxer must not. */
export function hlsBehindFtyp(url: string): Buffer {
  const ftyp = Buffer.alloc(20)
  ftyp.writeUInt32BE(20, 0)
  ftyp.write('ftypisom', 4, 'latin1')
  ftyp.writeUInt32BE(512, 12)
  ftyp.write('isom', 16, 'latin1')
  return Buffer.concat([ftyp, hlsPlaylist(url)])
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/**
 * A PNG of a few hundred bytes whose header says `width`×`height` (a decompression bomb): only
 * the first row of pixels is there.
 */
export function pngBomb(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(0, 9) // greyscale
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(Math.min(width + 1, 1 << 16)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A PNG in Display P3 of one colour, red-orange, that sRGB shows differently. */
export function displayP3Png(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 80, b: 60 } },
  })
    .withIccProfile('p3')
    .png()
    .toBuffer()
}

/** The first pixel of an image and whether it carries a colour profile. */
export async function firstPixel(bytes: Buffer): Promise<{ rgb: number[]; icc: boolean }> {
  const meta = await sharp(bytes).metadata()
  const data = await sharp(bytes).raw().toBuffer()
  return { rgb: [...data.subarray(0, 3)], icc: meta.icc !== undefined }
}

/**
 * An H.264 MP4 whose stream switches from `small` to `large` frames halfway: the header (the
 * first SPS) says only `small`.
 */
export function makeResolutionSwitch(dir: string, small: string, large: string): string {
  const part = (size: string, name: string) => {
    const path = join(dir, name)
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=${size}:rate=10`,
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-bsf:v',
        'h264_mp4toannexb',
        '-f',
        'h264',
        path,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    )
    return path
  }
  const joined = join(dir, 'switch.h264')
  writeFileSync(
    joined,
    Buffer.concat([readFileSync(part(small, 'a.h264')), readFileSync(part(large, 'b.h264'))]),
  )
  const out = join(dir, 'switch.mp4')
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-r', '10', '-i', joined, '-c', 'copy', out],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  return out
}
