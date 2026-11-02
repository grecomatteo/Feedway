import type { ZipWriter } from '@app/application'
import { zipSync, type Zippable } from 'fflate'

/** fflate, compressed in this thread: the archive holds a few JSON files and a small photo. */
export function createZipWriter(): ZipWriter {
  return {
    create(entries) {
      const files: Zippable = {}
      for (const entry of entries) {
        if (entry.path in files) throw new Error(`duplicate path in archive: ${entry.path}`)
        // a WebP is already compressed
        files[entry.path] = [entry.data, { level: entry.path.endsWith('.webp') ? 0 : 6 }]
      }
      return zipSync(files)
    },
  }
}
