import { expect, test } from 'vitest'
import {
  UPLOAD_PART_BYTES,
  missingUploadParts,
  sha256OfContentDigest,
  sniffMedia,
  uploadPartCount,
  uploadPartSize,
} from './upload.js'

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((p) =>
      typeof p === 'string' ? Array.from({ length: p.length }, (_, i) => p.charCodeAt(i)) : p,
    ),
  )

/** A leading `ftyp` box with these brands. */
function ftyp(major: string, ...compatible: string[]) {
  const size = 16 + 4 * compatible.length
  return bytes([0, 0, 0, size], 'ftyp', major, [0, 0, 0, 0], ...compatible, 'moov')
}

test('a file is cut into pieces of 20 MiB, the last one smaller', () => {
  expect(UPLOAD_PART_BYTES).toBe(20_971_520)
  expect(uploadPartCount(1)).toBe(1)
  expect(uploadPartCount(UPLOAD_PART_BYTES)).toBe(1)
  expect(uploadPartCount(UPLOAD_PART_BYTES + 1)).toBe(2)
  const size = 2 * UPLOAD_PART_BYTES + 7
  expect([1, 2, 3].map((n) => uploadPartSize(size, n))).toEqual([
    UPLOAD_PART_BYTES,
    UPLOAD_PART_BYTES,
    7,
  ])
  for (const n of [0, 4, 1.5, -1]) expect(uploadPartSize(size, n)).toBeNull()
})

test('the missing pieces, in order', () => {
  expect(missingUploadParts(3 * UPLOAD_PART_BYTES, [2])).toEqual([1, 3])
  expect(missingUploadParts(10, [1])).toEqual([])
})

test('the type comes from the first bytes', () => {
  expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))?.format).toBe('jpeg')
  expect(sniffMedia(bytes([0x89], 'PNG\r\n\x1a\n'))).toMatchObject({
    format: 'png',
    extension: 'png',
  })
  expect(sniffMedia(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))?.format).toBe('webp')
  expect(sniffMedia(ftyp('heic', 'mif1', 'heic'))).toMatchObject({ kind: 'image', format: 'heic' })
  expect(sniffMedia(ftyp('mif1', 'mif1', 'heic'))?.format).toBe('heic')
  expect(sniffMedia(ftyp('qt  ', 'qt  '))).toMatchObject({
    kind: 'video',
    format: 'mov',
    mime: 'video/quicktime',
    extension: 'mov',
  })
  expect(sniffMedia(ftyp('isom', 'isom', 'avc1', 'mp41'))).toMatchObject({
    format: 'mp4',
    mime: 'video/mp4',
  })
  // an unknown major brand that lists a known one is still that container
  expect(sniffMedia(ftyp('XAVC', 'qt  '))?.format).toBe('mov')
})

test('anything else is no type Feedway takes', () => {
  const refused = [
    bytes('MZ', [0x90, 0, 3, 0]), // a Windows executable named .jpg
    bytes([0x7f], 'ELF', [2, 1, 1]),
    bytes('#EXTM3U\n#EXT-X-VERSION:3\n'), // an HLS playlist named .mp4
    bytes('ffconcat version 1.0\nfile /etc/passwd\n'),
    bytes('GIF89a'),
    bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ftyp('avif', 'avif', 'mif1'), // AVIF: a HEIF that is not HEVC
    ftyp('mif1', 'mif1', 'miaf'),
    ftyp('abcd', 'efgh'),
    bytes([0, 0, 0, 8], 'mdat'), // QuickTime without ftyp: not taken (ffmpeg blindato)
    bytes(),
  ]
  for (const b of refused) expect(sniffMedia(b)).toBeNull()
})

test('Content-Digest gives the sha256 as hex, or null', () => {
  const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const b64 = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
  expect(sha256OfContentDigest(`sha-256=:${b64}:`)).toBe(hex)
  expect(sha256OfContentDigest(`sha-512=:AAAA:, sha-256=:${b64}:`)).toBe(hex)
  for (const bad of [
    undefined,
    '',
    b64,
    `sha-256=${b64}`,
    'sha-256=:AAAA:',
    `sha-256=:${b64.slice(1)}:`,
    `sha-256=:${b64.replace('+', '-')}:`,
  ])
    expect(sha256OfContentDigest(bad), String(bad)).toBeNull()
})
