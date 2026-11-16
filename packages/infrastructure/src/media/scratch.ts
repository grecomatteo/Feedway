import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { MediaScratch, ScratchFolder } from '@app/application'

// The worker's folders for one file at a time (plan 04 Task 10), on the media volume: the
// container's /tmp is memory, and a video of 300 MB with its copies would fill it.

const PREFIX = 'media-'
const SAFE_NAME = /^[a-z0-9_.-]{1,64}$/

function nameOf(name: string): string {
  // the names are constants of the use case; anything else is a bug
  if (!SAFE_NAME.test(name) || name.startsWith('.')) throw new Error(`bad work file name: ${name}`)
  return name
}

export function createMediaScratch(opts: { dir: string }): MediaScratch {
  return {
    async open(): Promise<ScratchFolder> {
      await mkdir(opts.dir, { recursive: true, mode: 0o700 })
      const folder = await mkdtemp(join(opts.dir, PREFIX))
      const inside = (path: string) => {
        if (!path.startsWith(`${folder}/`)) throw new Error('work file outside its folder')
        return path
      }
      return {
        async write(name, body) {
          const path = join(folder, nameOf(name))
          await pipeline(Readable.from(body), createWriteStream(path, { flags: 'wx' }))
          return path
        },
        path: (name) => join(folder, nameOf(name)),
        read: (path) => createReadStream(inside(path)),
        size: async (path) => (await stat(inside(path))).size,
        dispose: () => rm(folder, { recursive: true, force: true }),
      }
    },

    async sweep(ms) {
      let entries: string[]
      try {
        entries = await readdir(opts.dir)
      } catch {
        return 0
      }
      const before = Date.now() - ms
      let removed = 0
      for (const name of entries) {
        if (!name.startsWith(PREFIX)) continue
        const path = join(opts.dir, name)
        const info = await stat(path).catch(() => null)
        if (info?.isDirectory() && info.mtimeMs < before) {
          await rm(path, { recursive: true, force: true })
          removed += 1
        }
      }
      return removed
    },
  }
}
