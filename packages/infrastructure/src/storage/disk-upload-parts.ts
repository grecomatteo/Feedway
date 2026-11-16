import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ReceivedPart, UploadParts } from '@app/application'

// The pieces of the uploads on the web's disk (ADR 021, Scelta 4): `<dir>/<agency>/<upload>/<n>`,
// every name built from ids the server checked, never from the request. A piece is written
// under a temporary name and takes its number only once its size and sha256 are known good.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PENDING = /^\.[0-9a-f]{16}\.part$/

const errno = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined

export function createDiskUploadParts(opts: { dir: string }): UploadParts {
  const root = resolve(opts.dir)

  function folderOf(organizationId: string, uploadId: string): string {
    if (!UUID.test(organizationId) || !UUID.test(uploadId))
      throw new Error('upload pieces: not an id')
    return join(root, organizationId, uploadId)
  }
  function pieceOf(organizationId: string, uploadId: string, n: number): string {
    if (!Number.isSafeInteger(n) || n < 1) throw new Error('upload pieces: not a piece number')
    return join(folderOf(organizationId, uploadId), String(n))
  }
  function pendingOf(organizationId: string, uploadId: string, pending: string): string {
    if (!PENDING.test(pending)) throw new Error('upload pieces: not a pending piece')
    return join(folderOf(organizationId, uploadId), pending)
  }

  return {
    async receive(organizationId, uploadId, body, maxBytes) {
      const folder = folderOf(organizationId, uploadId)
      await mkdir(folder, { recursive: true })
      const pending = `.${randomBytes(8).toString('hex')}.part`
      const path = join(folder, pending)
      const file = await open(path, 'wx')
      const hash = createHash('sha256')
      let size = 0
      let tooLarge = false
      try {
        for await (const chunk of body) {
          size += chunk.byteLength
          // the rest is not read: the caller answers and closes the connection
          if (size > maxBytes) {
            tooLarge = true
            break
          }
          hash.update(chunk)
          await file.write(chunk)
        }
        await file.close()
      } catch (error) {
        await file.close().catch(() => undefined)
        await rm(path, { force: true })
        throw error
      }
      if (tooLarge) {
        await rm(path, { force: true })
        return 'too_large'
      }
      return { size, sha256: hash.digest('hex'), pending } satisfies ReceivedPart
    },
    async keep(organizationId, uploadId, n, pending) {
      await rename(
        pendingOf(organizationId, uploadId, pending),
        pieceOf(organizationId, uploadId, n),
      )
    },
    async discard(organizationId, uploadId, pending) {
      await rm(pendingOf(organizationId, uploadId, pending), { force: true })
    },
    async head(organizationId, uploadId, bytes) {
      const file = await open(pieceOf(organizationId, uploadId, 1), 'r')
      try {
        const buffer = Buffer.alloc(bytes)
        const { bytesRead } = await file.read(buffer, 0, bytes, 0)
        return new Uint8Array(buffer.subarray(0, bytesRead))
      } finally {
        await file.close()
      }
    },
    assemble(organizationId, uploadId, count) {
      const hash = createHash('sha256')
      let done = false
      async function* body() {
        for (let n = 1; n <= count; n++)
          for await (const chunk of createReadStream(pieceOf(organizationId, uploadId, n))) {
            const bytes = chunk as Buffer
            hash.update(bytes)
            yield new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          }
        done = true
      }
      return {
        body: body(),
        sha256() {
          if (!done) throw new Error('the upload was not read to the end')
          return hash.digest('hex')
        },
      }
    },
    async remove(organizationId, uploadId) {
      await rm(folderOf(organizationId, uploadId), { recursive: true, force: true })
    },
    async list(organizationId) {
      if (!UUID.test(organizationId)) throw new Error('upload pieces: not an id')
      let entries
      try {
        entries = await readdir(join(root, organizationId), { withFileTypes: true })
      } catch (error) {
        if (errno(error) === 'ENOENT') return []
        throw error
      }
      const out: { uploadId: string; modifiedAt: Date }[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue
        const info = await stat(join(root, organizationId, entry.name))
        out.push({ uploadId: entry.name, modifiedAt: info.mtime })
      }
      return out
    },
  }
}
