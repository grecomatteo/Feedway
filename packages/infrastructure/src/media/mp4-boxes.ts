import { open } from 'node:fs/promises'

// The top-level boxes of an MP4 or MOV, read from their headers only (8 or 16 bytes each):
// whether the index (`moov`) comes before the data (`mdat`), so a player starts at once.

const MAX_BOXES = 10_000

/**
 * True when `moov` comes before the first `mdat`; false when after it, or when one is missing
 * (the remux writes it at the start anyway).
 */
export async function moovBeforeMdat(path: string): Promise<boolean> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const header = Buffer.alloc(16)
    let at = 0
    for (let n = 0; n < MAX_BOXES && at + 8 <= size; n += 1) {
      const { bytesRead } = await file.read(header, 0, 16, at)
      if (bytesRead < 8) return false
      const type = header.toString('latin1', 4, 8)
      let boxSize = header.readUInt32BE(0)
      if (boxSize === 1) {
        if (bytesRead < 16) return false
        boxSize = Number(header.readBigUInt64BE(8))
      } else if (boxSize === 0) boxSize = size - at
      if (type === 'moov') return true
      if (type === 'mdat') return false
      if (boxSize < 8) return false
      at += boxSize
    }
    return false
  } finally {
    await file.close()
  }
}
