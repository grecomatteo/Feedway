import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Storage } from '@app/application'
import { DomainError } from '@app/domain'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const OWNER = `(org|users)/${UUID}/`
// Segments never start with a dot: the temporary files and `.meta.json` companions live
// beside the objects and must not be reachable as keys.
const SEGMENT = '[a-z0-9_-][a-z0-9._-]*'
const KEY = new RegExp(`^${OWNER}(${SEGMENT}/)*${SEGMENT}$`)
const PREFIX = new RegExp(`^${OWNER}(${SEGMENT}/)*$`)
const META = '.meta.json'

interface Meta {
  contentType: string
}

const invalid = (what: string) =>
  new DomainError('VALIDATION', `Percorso di archiviazione non valido: ${what}`)

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

/** Files under `root`, written atomically, with the content type in `<file>.meta.json`. */
export function createLocalDiskStorage(opts: { root: string }): Storage {
  const root = resolve(opts.root)

  function pathOf(key: string, pattern: RegExp): string {
    if (!pattern.test(key) || key.endsWith(META)) throw invalid(key)
    const path = resolve(root, key)
    // belt and braces: the pattern already rules out `..` and absolute paths
    if (!path.startsWith(root + sep)) throw invalid(key)
    return path
  }
  const metaOf = (path: string) => `${path}${META}`
  const tempNear = (path: string) => join(dirname(path), `.${randomBytes(8).toString('hex')}.tmp`)

  async function walk(dir: string): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const files: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...(await walk(full)))
      else if (entry.isFile() && !entry.name.endsWith(META)) files.push(full)
    }
    return files
  }

  const storage: Storage = {
    async put(key, body, { contentType }) {
      const path = pathOf(key, KEY)
      await mkdir(dirname(path), { recursive: true })
      const dataTemp = tempNear(path)
      const metaTemp = tempNear(path)
      let size = 0
      try {
        const source = Buffer.isBuffer(body) ? Readable.from([body]) : Readable.from(body)
        source.on('data', (chunk: Uint8Array) => {
          size += chunk.byteLength
        })
        await pipeline(source, createWriteStream(dataTemp, { flags: 'wx' }))
        await writeFile(metaTemp, JSON.stringify({ contentType } satisfies Meta), { flag: 'wx' })
        // meta first: a crash between the two renames leaves no object without its type
        await rename(metaTemp, metaOf(path))
        await rename(dataTemp, path)
      } catch (error) {
        await rm(dataTemp, { force: true })
        await rm(metaTemp, { force: true })
        throw error
      }
      return { size }
    },

    async get(key) {
      const path = pathOf(key, KEY)
      let info
      try {
        info = await stat(path)
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
      let contentType = 'application/octet-stream'
      try {
        contentType = (JSON.parse(await readFile(metaOf(path), 'utf8')) as Meta).contentType
      } catch (error) {
        if (!missing(error)) throw error
      }
      return { body: createReadStream(path), size: info.size, contentType }
    },

    async delete(key) {
      const path = pathOf(key, KEY)
      await rm(path, { force: true })
      await rm(metaOf(path), { force: true })
    },

    async deletePrefix(prefix) {
      const objects = await storage.list(prefix)
      for (const { key } of objects) await storage.delete(key)
      await rm(pathOf(prefix, PREFIX), { recursive: true, force: true })
      return objects.length
    },

    async list(prefix) {
      const dir = pathOf(prefix, PREFIX)
      const files = await walk(dir)
      const listed = await Promise.all(
        files.map(async (file) => {
          const info = await stat(file)
          return {
            key: relative(root, file).split(sep).join('/'),
            size: info.size,
            modifiedAt: info.mtime,
          }
        }),
      )
      return listed.sort((a, b) => a.key.localeCompare(b.key))
    },
  }
  return storage
}
