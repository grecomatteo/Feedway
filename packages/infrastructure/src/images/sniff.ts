import type { AvatarSourceType } from '@app/domain'

/** Brands of HEIF files whose images are HEVC: what iPhones write. AVIF (AV1) is not one. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'])
/** Generic HEIF brands: a HEIC only if a HEVC brand is among the compatible ones. */
const HEIF_BRANDS = new Set(['mif1', 'msf1'])

const ascii = (bytes: Buffer, from: number, to: number) => bytes.toString('latin1', from, to)

function isHeic(bytes: Buffer): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false
  const major = ascii(bytes, 8, 12)
  if (HEIC_BRANDS.has(major)) return true
  if (!HEIF_BRANDS.has(major)) return false
  // compatible brands follow the minor version, up to the end of the box
  const end = Math.min(bytes.readUInt32BE(0), bytes.length, 256)
  for (let at = 16; at + 4 <= end; at += 4)
    if (HEIC_BRANDS.has(ascii(bytes, at, at + 4))) return true
  return false
}

/**
 * The image type from the first bytes, whatever the file name or the declared type say. Only
 * the types a profile photo may be: GIF, SVG, PDF, AVIF and the rest are null.
 */
export function sniffImageType(bytes: Buffer): AvatarSourceType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return 'webp'
  if (isHeic(bytes)) return 'heic'
  return null
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
