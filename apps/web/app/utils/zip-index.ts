// A zip read in the browser (D-104, D-110): only its index (the central directory) for the preview,
// then one entry at a time, sliced from the file and inflated by the browser itself
// (`DecompressionStream`), so no library and nothing whole in memory. What the index says is not
// trusted: the bytes are counted while they come out, and an entry stops past its limit.

export interface ZipEntry {
  /** the name as written in the zip, not yet checked (see `upload-tree.ts`) */
  name: string
  /** 0 stored, 8 deflated */
  method: 0 | 8
  compressedSize: number
  /** what the index says: checked against the bytes that come out */
  size: number
  localOffset: number
  directory: boolean
}

export type ZipProblem =
  /** no end of central directory: not a zip, or cut */
  | 'not_zip'
  /** Zip64: over 4 GB or 65 535 entries (D-110: the folder is uploaded instead) */
  | 'zip64'
  /** a password */
  | 'encrypted'
  /** a compression other than stored and deflate */
  | 'method'
  /** offsets or sizes outside the file */
  | 'broken'

export class ZipError extends Error {
  constructor(readonly problem: ZipProblem) {
    super(`zip: ${problem}`)
  }
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
/** the end record (22 bytes) and a comment of at most 65 535 */
const TAIL = 22 + 0xffff
/** the index read whole, at most: 65 535 entries with long names fit */
const MAX_INDEX_BYTES = 32 * 1024 * 1024

async function bytes(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin = new TextDecoder('windows-1252')
/** UTF-8 when the zip says so or the bytes are valid UTF-8 (macOS does not say it), else Windows. */
function decodeName(raw: Uint8Array, flagged: boolean) {
  if (flagged) return new TextDecoder('utf-8').decode(raw)
  try {
    return utf8.decode(raw)
  } catch {
    return latin.decode(raw)
  }
}

/** The entries of a zip, from its central directory; throws a `ZipError`. */
export async function readZipIndex(file: Blob): Promise<ZipEntry[]> {
  const from = Math.max(0, file.size - TAIL)
  const tail = await bytes(file, from, file.size)
  let end = -1
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === EOCD) {
      end = i
      break
    }
  if (end < 0) throw new ZipError('not_zip')
  const count = tail.getUint16(end + 10, true)
  const dirSize = tail.getUint32(end + 12, true)
  const dirOffset = tail.getUint32(end + 16, true)
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff)
    throw new ZipError('zip64')
  if (dirOffset + dirSize > from + end) throw new ZipError('broken')
  // 150 files need a few kB: an index this big is a trap, not a zip of photos
  if (dirSize > MAX_INDEX_BYTES) throw new ZipError('broken')

  const dir = await bytes(file, dirOffset, dirOffset + dirSize)
  const entries: ZipEntry[] = []
  let at = 0
  for (let n = 0; n < count; n++) {
    if (at + 46 > dir.byteLength || dir.getUint32(at, true) !== CENTRAL)
      throw new ZipError('broken')
    const flags = dir.getUint16(at + 8, true)
    const method = dir.getUint16(at + 10, true)
    const compressedSize = dir.getUint32(at + 20, true)
    const size = dir.getUint32(at + 24, true)
    const nameLength = dir.getUint16(at + 28, true)
    const extraLength = dir.getUint16(at + 30, true)
    const commentLength = dir.getUint16(at + 32, true)
    const localOffset = dir.getUint32(at + 42, true)
    if (at + 46 + nameLength > dir.byteLength) throw new ZipError('broken')
    const raw = new Uint8Array(dir.buffer, dir.byteOffset + at + 46, nameLength)
    const name = decodeName(raw, (flags & 0x800) !== 0)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw new ZipError('zip64')
    const directory = name.endsWith('/') || name.endsWith('\\')
    if (!directory) {
      if (flags & 0x1) throw new ZipError('encrypted')
      if (method !== 0 && method !== 8) throw new ZipError('method')
      if (localOffset + compressedSize > dirOffset) throw new ZipError('broken')
    }
    entries.push({
      name,
      method: method === 8 ? 8 : 0,
      compressedSize,
      size,
      localOffset,
      directory,
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Thrown when an entry gives more bytes than `limit`, or other than the index says. */
export class ZipEntryTooBig extends Error {
  constructor(readonly limit: number) {
    super('zip entry over its limit')
  }
}

/**
 * The bytes of one entry, as a `File` named `name`: sliced from the zip, inflated when deflated,
 * counted while they come out. It stops past `limit`, and when the bytes are not as many as
 * the index says (an index that lies: D-110).
 */
export async function readZipEntry(
  zip: Blob,
  entry: ZipEntry,
  opts: { name: string; type: string; limit: number },
): Promise<File> {
  const head = await bytes(zip, entry.localOffset, entry.localOffset + 30)
  if (head.byteLength < 30 || head.getUint32(0, true) !== LOCAL) throw new ZipError('broken')
  const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
  const end = start + entry.compressedSize
  if (end > zip.size) throw new ZipError('broken')
  const raw = zip.slice(start, end)
  const cap = Math.min(opts.limit, entry.size)
  if (entry.method === 0) {
    if (raw.size > opts.limit) throw new ZipEntryTooBig(opts.limit)
    if (raw.size !== entry.size) throw new ZipError('broken')
    return new File([raw], opts.name, { type: opts.type })
  }
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel()
      throw total > opts.limit ? new ZipEntryTooBig(opts.limit) : new ZipError('broken')
    }
    chunks.push(value)
  }
  if (total !== entry.size) throw new ZipError('broken')
  return new File(chunks as BlobPart[], opts.name, { type: opts.type })
}
