import { crc32 } from 'node:zlib'

/** A zip with stored entries, as a small zip from macOS or Windows is: for the zip upload tests. */
export function storedZip(entries: { name: string; data: Uint8Array }[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const { name, data } of entries) {
    const raw = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.byteLength, 18)
    local.writeUInt32LE(data.byteLength, 22)
    local.writeUInt16LE(raw.byteLength, 26)
    parts.push(local, raw, Buffer.from(data))
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(data.byteLength, 20)
    head.writeUInt32LE(data.byteLength, 24)
    head.writeUInt16LE(raw.byteLength, 28)
    head.writeUInt32LE(offset, 42)
    central.push(head, raw)
    offset += 30 + raw.byteLength + data.byteLength
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}
