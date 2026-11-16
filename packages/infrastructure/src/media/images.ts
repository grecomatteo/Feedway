import { readFile, stat, writeFile } from 'node:fs/promises'
import type { MadeFile, ToolResult } from '@app/application'
import { PROBE_TIMEOUT_MS, THUMBNAIL_LONG_SIDE, type FileAnalysis } from '@app/domain'
import sharp, { type Metadata, type Sharp } from 'sharp'
import { decodeHeic } from '../images/heic-decoder.js'

// The photos of the library (spec §9.2): sharp (libvips) for JPEG, PNG and WebP, libheif-js
// for the HEIC of iPhones. The header is read first, without decoding: an image over the pixel
// limit is never decoded.

type ImageAnalysis = Extract<FileAnalysis, { kind: 'image' }>
type ImageFormat = ImageAnalysis['format']

/** sharp's name of each format, as the bytes said it */
const SHARP_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  heic: 'heif',
}
const QUALITIES = [88, 80, 72, 64, 56, 48]
const WHITE = { r: 255, g: 255, b: 255 }
const TIMEOUT_SECONDS = PROBE_TIMEOUT_MS / 1000

/**
 * The description of an ICC profile (the `desc` tag, version 2 or 4): «sRGB IEC61966-2.1»,
 * «Display P3». null when it cannot be read.
 */
export function iccDescription(icc: Buffer): string | null {
  // the profile comes from the file: a malformed one is no description, never an error
  try {
    return readDescription(icc)
  } catch {
    return null
  }
}

function readDescription(icc: Buffer): string | null {
  if (icc.length < 132) return null
  const count = icc.readUInt32BE(128)
  for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i += 1) {
    const at = 132 + i * 12
    if (icc.toString('latin1', at, at + 4) !== 'desc') continue
    const offset = icc.readUInt32BE(at + 4)
    const size = icc.readUInt32BE(at + 8)
    if (offset + size > icc.length || size < 12) return null
    const type = icc.toString('latin1', offset, offset + 4)
    if (type === 'desc') {
      const length = icc.readUInt32BE(offset + 8)
      return icc
        .toString('latin1', offset + 12, Math.min(offset + 12 + length, offset + size))
        .replace(/\0+$/, '')
    }
    if (type === 'mluc' && size >= 28) {
      const length = icc.readUInt32BE(offset + 20)
      const start = offset + icc.readUInt32BE(offset + 24)
      const end = Math.min(start + length, offset + size, icc.length)
      if (start >= end) return null
      // UTF-16: an even number of bytes
      const utf16 = Buffer.from(icc.subarray(start, start + Math.floor((end - start) / 2) * 2))
      return utf16.swap16().toString('utf16le')
    }
    return null
  }
  return null
}

function colorSpaceOf(meta: Metadata): ImageAnalysis['colorSpace'] {
  if (!meta.icc) return null
  return /srgb/i.test(iccDescription(meta.icc) ?? '') ? 'srgb' : 'other'
}

/**
 * What a sharp error means: its timeout, a passing failure of the machine (a full disk: thrown,
 * so the job is retried), or bytes the decoder refused.
 */
function refusalOf(error: unknown): 'timeout' | 'unreadable' {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw error
  if (error instanceof Error && /timeout/i.test(error.message)) return 'timeout'
  if (error instanceof Error && /no space left|ENOSPC/i.test(error.message)) throw error
  return 'unreadable'
}

export function createImageTools() {
  // one libvips thread: the worker never takes both cores (§16.6); no cache of decoded images
  sharp.concurrency(1)
  sharp.cache(false)

  /** What the header says. sharp reads the HEIC container too, without decoding its HEVC. */
  async function probeImage(
    path: string,
    format: ImageFormat,
  ): Promise<ToolResult<{ analysis: ImageAnalysis }>> {
    let meta: Metadata
    try {
      meta = await sharp(path, { limitInputPixels: false, failOn: 'error' }).metadata()
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
    // libvips reads the type from the bytes too: both must agree
    if (meta.format !== SHARP_FORMAT[format] || !meta.width || !meta.height)
      return { ok: false, reason: 'unreadable' }
    const turned = (meta.orientation ?? 1) >= 5
    return {
      ok: true,
      analysis: {
        kind: 'image',
        format,
        sizeBytes: (await stat(path)).size,
        width: turned ? meta.height : meta.width,
        height: turned ? meta.width : meta.height,
        colorSpace: colorSpaceOf(meta),
        hasMetadata: Boolean(meta.exif ?? meta.xmp ?? meta.iptc),
      },
    }
  }

  /** The pixels, upright, decoded with the limit; null: refused by the decoder. */
  async function source(
    path: string,
    format: ImageFormat,
    maxPixels: number,
  ): Promise<ToolResult<{ image: Sharp }>> {
    if (format === 'heic') {
      const heic = await decodeHeic(await readFile(path), {
        maxPixels,
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      if (!heic.ok)
        return { ok: false, reason: heic.reason === 'timeout' ? 'timeout' : 'unreadable' }
      return {
        ok: true,
        image: sharp(heic.data, { raw: { width: heic.width, height: heic.height, channels: 4 } }),
      }
    }
    return {
      ok: true,
      image: sharp(path, { limitInputPixels: maxPixels, failOn: 'error', pages: 1 }).autoOrient(),
    }
  }

  return {
    probeImage,

    /**
     * JPEG in sRGB (sharp converts from the embedded profile and leaves the metadata out),
     * upright, at most `maxWidth` wide, recompressed until under `maxBytes`.
     */
    async photo(
      path: string,
      output: string,
      opts: { format: ImageFormat; maxWidth: number; maxBytes: number; maxPixels: number },
    ): Promise<ToolResult<{ file: MadeFile }>> {
      const src = await source(path, opts.format, opts.maxPixels)
      if (!src.ok) return src
      let resized: Buffer
      try {
        // decoded once: every quality below starts from these pixels
        resized = await src.image
          .resize({ width: opts.maxWidth, withoutEnlargement: true })
          .flatten({ background: WHITE })
          .toColourspace('srgb')
          .timeout({ seconds: TIMEOUT_SECONDS })
          .png({ compressionLevel: 1 })
          .toBuffer()
      } catch (error) {
        return { ok: false, reason: refusalOf(error) }
      }
      for (const quality of QUALITIES) {
        const { data, info } = await sharp(resized)
          .jpeg({ quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true })
        if (data.length <= opts.maxBytes || quality === QUALITIES.at(-1)) {
          await writeFile(output, data)
          return {
            ok: true,
            file: {
              path: output,
              mime: 'image/jpeg',
              sizeBytes: data.length,
              width: info.width,
              height: info.height,
            },
          }
        }
      }
      return { ok: false, reason: 'unreadable' }
    },

    /** A small JPEG of a JPEG made above. */
    async thumbnail(path: string, output: string): Promise<ToolResult<{ file: MadeFile }>> {
      try {
        const info = await sharp(path, { failOn: 'error' })
          .resize(THUMBNAIL_LONG_SIDE, THUMBNAIL_LONG_SIDE, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(output)
        return {
          ok: true,
          file: {
            path: output,
            mime: 'image/jpeg',
            sizeBytes: info.size,
            width: info.width,
            height: info.height,
          },
        }
      } catch (error) {
        return { ok: false, reason: refusalOf(error) }
      }
    },
  }
}
