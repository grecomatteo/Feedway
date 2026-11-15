import type { MediaKind } from './media.js'

// An upload in pieces (ADR 021, plan 04 Task 9): what is declared when it starts, how the file
// is cut, and what its first bytes say it is.

/** 20 MiB: every piece but the last one has exactly this size (ADR 008, ADR 021). */
export const UPLOAD_PART_BYTES = 20 * 1024 * 1024

/** An upload not completed is removed after a day (ADR 021, Scelta 4). */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

/** The types a person may declare: photos and videos only; the bytes decide in the end. */
export const UPLOAD_DECLARED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
] as const
export type UploadDeclaredType = (typeof UPLOAD_DECLARED_TYPES)[number]

export const isUploadDeclaredType = (value: string): value is UploadDeclaredType =>
  (UPLOAD_DECLARED_TYPES as readonly string[]).includes(value)

export const declaredKind = (type: UploadDeclaredType): MediaKind =>
  type.startsWith('video/') ? 'video' : 'image'

export const uploadPartCount = (sizeBytes: number) => Math.ceil(sizeBytes / UPLOAD_PART_BYTES)

/** The size piece `n` (from 1) must have; null: there is no such piece. */
export function uploadPartSize(sizeBytes: number, n: number): number | null {
  const count = uploadPartCount(sizeBytes)
  if (!Number.isInteger(n) || n < 1 || n > count) return null
  return n < count ? UPLOAD_PART_BYTES : sizeBytes - (count - 1) * UPLOAD_PART_BYTES
}

/** The pieces still missing, in order: what the browser sends after a fall. */
export function missingUploadParts(sizeBytes: number, received: readonly number[]): number[] {
  const have = new Set(received)
  return Array.from({ length: uploadPartCount(sizeBytes) }, (_, i) => i + 1).filter(
    (n) => !have.has(n),
  )
}

/** What the first bytes of a file say it is; only the types Feedway takes. */
export interface SniffedMedia {
  kind: MediaKind
  format: 'jpeg' | 'png' | 'webp' | 'heic' | 'mp4' | 'mov'
  mime: string
  /** of the stored original: chosen here, never taken from the file name */
  extension: string
}

/** How many first bytes `sniffMedia` reads at most. */
export const SNIFF_BYTES = 256

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to))

/** HEIF brands of HEVC images (what iPhones write); AVIF is not one. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'])
const HEIF_BRANDS = new Set(['mif1', 'msf1'])
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4VP',
  'MSNV',
  'dash',
  'mmp4',
])
const MOV_BRAND = 'qt  '

/** The major brand and the compatible ones of a leading `ftyp` box; null without one. */
function ftypBrands(bytes: Uint8Array): { major: string; compatible: string[] } | null {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = Math.min(view.getUint32(0), bytes.length)
  const compatible: string[] = []
  for (let at = 16; at + 4 <= end; at += 4) compatible.push(ascii(bytes, at, at + 4))
  return { major: ascii(bytes, 8, 12), compatible }
}

const IMAGE = (format: 'jpeg' | 'png' | 'webp' | 'heic', mime: string, extension: string) =>
  ({ kind: 'image', format, mime, extension }) as const
const VIDEO = (format: 'mp4' | 'mov', mime: string) =>
  ({ kind: 'video', format, mime, extension: format }) as const

/**
 * The type of a file from its first bytes, whatever its name or declared type say. A video
 * needs a leading `ftyp` box (plan 04, ffmpeg blindato): a playlist named `.mp4` is nothing.
 */
export function sniffMedia(head: Uint8Array): SniffedMedia | null {
  const b = head.subarray(0, SNIFF_BYTES)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return IMAGE('jpeg', 'image/jpeg', 'jpg')
  if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n')
    return IMAGE('png', 'image/png', 'png')
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP')
    return IMAGE('webp', 'image/webp', 'webp')
  const ftyp = ftypBrands(b)
  if (!ftyp) return null
  const brands = [ftyp.major, ...ftyp.compatible]
  if (
    HEIC_BRANDS.has(ftyp.major) ||
    (HEIF_BRANDS.has(ftyp.major) && brands.some((x) => HEIC_BRANDS.has(x)))
  )
    return IMAGE('heic', 'image/heic', 'heic')
  if (HEIF_BRANDS.has(ftyp.major) || ftyp.major === 'avif') return null
  if (ftyp.major === MOV_BRAND) return VIDEO('mov', 'video/quicktime')
  if (MP4_BRANDS.has(ftyp.major)) return VIDEO('mp4', 'video/mp4')
  if (brands.includes(MOV_BRAND)) return VIDEO('mov', 'video/quicktime')
  if (brands.some((x) => MP4_BRANDS.has(x))) return VIDEO('mp4', 'video/mp4')
  return null
}

const SHA256_HEX = /^[0-9a-f]{64}$/

export const isSha256Hex = (value: string) => SHA256_HEX.test(value)

/**
 * The sha256 of an HTTP `Content-Digest` (RFC 9530: `sha-256=:<base64>:`), as lowercase hex;
 * null when the header has no sha-256 digest or it is not 32 bytes.
 */
export function sha256OfContentDigest(header: string | null | undefined): string | null {
  if (!header) return null
  for (const member of header.split(',')) {
    const match = /^\s*sha-256\s*=\s*:([A-Za-z0-9+/]+={0,2}):\s*$/i.exec(member)
    if (!match?.[1]) continue
    const bytes = base64Bytes(match[1])
    if (bytes?.length !== 32) return null
    return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')
  }
  return null
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Strict base64 (padding required), without depending on Buffer or atob. */
function base64Bytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null
  const clean = text.replace(/=+$/, '')
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const digit = BASE64.indexOf(char)
    if (digit < 0) return null
    value = (value << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}
