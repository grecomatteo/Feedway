import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Storage } from '@app/application'
import { DomainError } from '@app/domain'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const OWNER = `(org|users)/${UUID}/`
// Segments never start with a dot: temporary files live beside the objects and must not
// be reachable as keys.
const SEGMENT = '[a-z0-9_-][a-z0-9._-]*'
const KEY = new RegExp(`^${OWNER}(${SEGMENT}/)*${SEGMENT}$`)
const PREFIX = new RegExp(`^${OWNER}(${SEGMENT}/)*$`)
// Printable ASCII only, so the one-line JSON header stays well under HEADER_READ bytes.
const CONTENT_TYPE = /^[\x20-\x7e]{1,200}$/
const HEADER_READ = 1024

const invalid = (what: string) =>
  new DomainError('VALIDATION', `Percorso di archiviazione non valido: ${what}`)

const errno = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
const missing = (error: unknown) => errno(error) === 'ENOENT'

/**
 * Files under `root`, written atomically. Each object is a single file: one JSON line with
 * the content type, then the bytes. Type and data therefore change together in one `rename`.
 */
export function createLocalDiskStorage(opts: { root: string }): Storage {
  const root = resolve(opts.root)

  function pathOf(key: string, pattern: RegExp): string {
    if (!pattern.test(key)) throw invalid(key)
    const path = resolve(root, key)
    // belt and braces: the pattern already rules out `..` and absolute paths
    if (!path.startsWith(root + sep)) throw invalid(key)
    return path
  }
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
      else if (entry.isFile()) files.push(full)
    }
    return files
  }

  async function headerOf(
    file: FileHandle,
  ): Promise<{ contentType: string; length: number } | null> {
    const buffer = Buffer.alloc(HEADER_READ)
    const { bytesRead } = await file.read(buffer, 0, HEADER_READ, 0)
    const end = buffer.subarray(0, bytesRead).indexOf(0x0a)
    if (end < 0) return null
    const parsed = JSON.parse(buffer.toString('utf8', 0, end)) as { contentType?: unknown }
    if (typeof parsed.contentType !== 'string') return null
    return { contentType: parsed.contentType, length: end + 1 }
  }

  const storage: Storage = {
    async put(key, body, { contentType }) {
      const path = pathOf(key, KEY)
      if (!CONTENT_TYPE.test(contentType)) throw invalid(`tipo di contenuto «${contentType}»`)
      const temp = tempNear(path)
      let size = 0
      async function* counted(): AsyncGenerator<Uint8Array> {
        const source = Buffer.isBuffer(body) ? Readable.from([body]) : Readable.from(body)
        for await (const chunk of source as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength
          yield chunk
        }
      }
      try {
        await mkdir(dirname(path), { recursive: true })
        const out = createWriteStream(temp, { flags: 'wx' })
        out.write(`${JSON.stringify({ contentType })}\n`)
        await pipeline(counted(), out)
        const file = await open(temp, 'r+')
        try {
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temp, path)
      } catch (error) {
        // best effort: the folder may not exist (the key sits under an object)
        await rm(temp, { force: true }).catch(() => undefined)
        // a key that is already a folder, or sits under an object
        if (['EISDIR', 'ERR_FS_EISDIR', 'ENOTDIR', 'EEXIST'].includes(errno(error) ?? ''))
          throw invalid(key)
        throw error
      }
      return { size }
    },

    async get(key) {
      const path = pathOf(key, KEY)
      let file
      try {
        file = await open(path, 'r')
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
      try {
        const info = await file.stat()
        const header = info.isFile() ? await headerOf(file) : null
        if (!header) {
          await file.close()
          return null
        }
        // the caller must consume or destroy `body`; that closes the descriptor
        const body = file.createReadStream({ start: header.length })
        return { body, size: info.size - header.length, contentType: header.contentType }
      } catch (error) {
        await file.close()
        throw error
      }
    },

    async delete(key) {
      const path = pathOf(key, KEY)
      try {
        await rm(path, { force: true })
      } catch (error) {
        // a key that names a folder is not an object: nothing to delete
        if (!['EISDIR', 'ERR_FS_EISDIR'].includes(errno(error) ?? '')) throw error
      }
    },

    async deletePrefix(prefix) {
      const count = (await storage.list(prefix)).length
      await rm(pathOf(prefix, PREFIX), { recursive: true, force: true })
      return count
    },

    async list(prefix) {
      const files = await walk(pathOf(prefix, PREFIX))
      const listed = await Promise.all(
        files.map(async (file) => {
          const handle = await open(file, 'r').catch((error: unknown) => {
            if (missing(error)) return null
            throw error
          })
          if (!handle) return null
          try {
            const [info, header] = [await handle.stat(), await headerOf(handle)]
            if (!header) return null
            return {
              key: relative(root, file).split(sep).join('/'),
              size: info.size - header.length,
              modifiedAt: info.mtime,
            }
          } finally {
            await handle.close()
          }
        }),
      )
      // byte order, like S3: not locale-dependent
      return listed
        .filter((o) => o !== null)
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    },
  }
  return storage
}
