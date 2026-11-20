import { crc32, deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  ZipEntryTooBig,
  ZipError,
  readZipEntry,
  readZipIndex,
  type ZipEntry,
} from '../app/utils/zip-index.ts'

interface Entry {
  name: string | Uint8Array
  data?: Uint8Array
  method?: 0 | 8
  /** UTF-8 flag (bit 11), as Windows 10 and later do not set and macOS does not either */
  utf8?: boolean
  /** sizes after the data (bit 3), as a zip written while streaming */
  descriptor?: boolean
  /** what the index says, to make an index that lies */
  declaredSize?: number
  encrypted?: boolean
  rawMethod?: number
}

/** A zip written by hand, as the tools of macOS and Windows write it. */
function makeZip(entries: Entry[], opts: { comment?: string; zip64?: boolean } = {}) {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = typeof e.name === 'string' ? new TextEncoder().encode(e.name) : e.name
    const data = e.data ?? new Uint8Array()
    const method = e.rawMethod ?? e.method ?? 0
    const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data
    const crc = crc32(data)
    const flags = (e.utf8 ? 0x800 : 0) | (e.descriptor ? 0x8 : 0) | (e.encrypted ? 0x1 : 0)
    const size = e.declaredSize ?? data.byteLength

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, flags, true)
    local.setUint16(8, method, true)
    if (!e.descriptor) {
      local.setUint32(14, crc, true)
      local.setUint32(18, body.byteLength, true)
      local.setUint32(22, size, true)
    }
    local.setUint16(26, name.byteLength, true)
    parts.push(new Uint8Array(local.buffer), name, body)
    let length = 30 + name.byteLength + body.byteLength
    if (e.descriptor) {
      const d = new DataView(new ArrayBuffer(16))
      d.setUint32(0, 0x08074b50, true)
      d.setUint32(4, crc, true)
      d.setUint32(8, body.byteLength, true)
      d.setUint32(12, size, true)
      parts.push(new Uint8Array(d.buffer))
      length += 16
    }

    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, flags, true)
    c.setUint16(10, method, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, body.byteLength, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.byteLength, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += length
  }
  const dirSize = central.reduce((s, p) => s + p.byteLength, 0)
  const comment = new TextEncoder().encode(opts.comment ?? '')
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, opts.zip64 ? 0xffff : entries.length, true)
  end.setUint16(10, opts.zip64 ? 0xffff : entries.length, true)
  end.setUint32(12, dirSize, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, comment.byteLength, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer), comment] as BlobPart[])
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill)
const text = async (f: Blob) => new Uint8Array(await f.arrayBuffer())
const problem = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (error) {
    if (error instanceof ZipError) return error.problem
    throw error
  }
  return null
}
const entryOf = async (zip: Blob, i = 0): Promise<ZipEntry> => {
  const entry = (await readZipIndex(zip)).at(i)
  if (!entry) throw new Error('no entry')
  return entry
}

describe('readZipIndex (only the zip’s index, for the preview)', () => {
  it('lists the entries, folders marked, with what the index says of each', async () => {
    const zip = makeZip([
      { name: 'novembre/' },
      { name: 'novembre/a.jpg', data: bytes(100), method: 8 },
      { name: 'novembre/b.mp4', data: bytes(50) },
    ])
    const list = await readZipIndex(zip)
    expect(list.map((e) => [e.name, e.directory, e.method, e.size])).toEqual([
      ['novembre/', true, 0, 0],
      ['novembre/a.jpg', false, 8, 100],
      ['novembre/b.mp4', false, 0, 50],
    ])
  })

  it('finds the index after a comment', async () => {
    const zip = makeZip([{ name: 'a.jpg', data: bytes(3) }], { comment: 'x'.repeat(5000) })
    expect((await readZipIndex(zip)).map((e) => e.name)).toEqual(['a.jpg'])
  })

  it('names from macOS (UTF-8, not flagged) and from Windows (code page) read right', async () => {
    const zip = makeZip([
      { name: 'caffè/città.jpg', data: bytes(1) },
      { name: 'flag/é.jpg', data: bytes(1), utf8: true },
      // «è» in Windows-1252, as the Windows zip of old writes it
      { name: new Uint8Array([0x70, 0xe8, 0x2e, 0x6a, 0x70, 0x67]), data: bytes(1) },
    ])
    expect((await readZipIndex(zip)).map((e) => e.name)).toEqual([
      'caffè/città.jpg',
      'flag/é.jpg',
      'pè.jpg',
    ])
  })

  it('says why a zip cannot be read', async () => {
    expect(await problem(readZipIndex(new Blob(['not a zip at all'])))).toBe('not_zip')
    expect(await problem(readZipIndex(makeZip([{ name: 'a.jpg' }], { zip64: true })))).toBe('zip64')
    expect(
      await problem(readZipIndex(makeZip([{ name: 'a.jpg', data: bytes(1), encrypted: true }]))),
    ).toBe('encrypted')
    expect(
      await problem(readZipIndex(makeZip([{ name: 'a.jpg', data: bytes(1), rawMethod: 12 }]))),
    ).toBe('method')
    const whole = await makeZip([{ name: 'a.jpg', data: bytes(10) }]).arrayBuffer()
    // the index cut away
    expect(await problem(readZipIndex(new Blob([whole.slice(0, 40), whole.slice(-22)])))).toBe(
      'broken',
    )
  })
})

describe('readZipEntry (one file at a time, counted while it comes out)', () => {
  const limit = { name: 'a.jpg', type: 'image/jpeg', limit: 1000 }

  it('gives a stored entry and a deflated one, byte for byte', async () => {
    const data = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 251))
    const zip = makeZip([
      { name: 'stored.jpg', data },
      { name: 'deflated.jpg', data, method: 8 },
    ])
    for (const i of [0, 1]) {
      const file = await readZipEntry(zip, await entryOf(zip, i), limit)
      expect(file.name).toBe('a.jpg')
      expect(file.type).toBe('image/jpeg')
      expect(await text(file)).toEqual(data)
    }
  })

  it('reads an entry whose sizes come after the data (data descriptor)', async () => {
    const zip = makeZip([{ name: 'a.jpg', data: bytes(200), method: 8, descriptor: true }])
    expect((await readZipEntry(zip, await entryOf(zip), limit)).size).toBe(200)
  })

  it('stops past the limit, whatever the index says', async () => {
    const big = makeZip([{ name: 'a.jpg', data: bytes(5000), method: 8 }])
    await expect(readZipEntry(big, await entryOf(big), limit)).rejects.toBeInstanceOf(
      ZipEntryTooBig,
    )
    // the index says 10 bytes: 500 come out (a zip bomb, small)
    const liar = makeZip([{ name: 'a.jpg', data: bytes(500), method: 8, declaredSize: 10 }])
    expect(await problem(readZipEntry(liar, await entryOf(liar), limit))).toBe('broken')
    const stored = makeZip([{ name: 'a.jpg', data: bytes(5000) }])
    await expect(readZipEntry(stored, await entryOf(stored), limit)).rejects.toBeInstanceOf(
      ZipEntryTooBig,
    )
  })

  it('an entry that gives fewer bytes than the index says is broken', async () => {
    const zip = makeZip([{ name: 'a.jpg', data: bytes(100), method: 8, declaredSize: 400 }])
    expect(await problem(readZipEntry(zip, await entryOf(zip), limit))).toBe('broken')
  })
})
