import type { Storage } from '@app/application'
import { afterEach, describe, expect, test } from 'vitest'

const u1 = '0197c5a0-0000-7000-8000-000000000001'
const u2 = '0197c5a0-0000-7000-8000-000000000002'
const webp = { contentType: 'image/webp' }
const bytes = Buffer.from('contenuto di prova')

async function read(body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function bytesOf(s: Storage, key: string): Promise<Buffer> {
  const found = await s.get(key)
  if (!found) throw new Error(`missing object ${key}`)
  return read(found.body)
}

async function exists(s: Storage, key: string): Promise<boolean> {
  const found = await s.get(key)
  if (!found) return false
  await read(found.body)
  return true
}

/** Tests every `Storage` implementation must pass; `makeStorage` returns a fresh, empty one. */
export function storageContract(
  name: string,
  makeStorage: () => Promise<{ storage: Storage; cleanup(): Promise<void> }>,
): void {
  describe(`Storage contract: ${name}`, () => {
    let current: { storage: Storage; cleanup(): Promise<void> } | undefined
    afterEach(async () => {
      await current?.cleanup()
      current = undefined
    })
    async function fresh(): Promise<Storage> {
      current = await makeStorage()
      return current.storage
    }

    test('put then get returns the same bytes and content type', async () => {
      const s = await fresh()
      const key = `users/${u1}/avatar/a.webp`
      expect(await s.put(key, bytes, webp)).toEqual({ size: bytes.length })
      const found = await s.get(key)
      expect(found).toMatchObject({ size: bytes.length, contentType: 'image/webp' })
      expect(await read(found?.body ?? [])).toEqual(bytes)
    })

    test('accepts a streamed body and overwrites an existing object', async () => {
      const s = await fresh()
      const key = `org/${u1}/export/x.zip`
      await s.put(key, bytes, webp)
      async function* parts() {
        yield Buffer.from('ab')
        await Promise.resolve()
        yield Buffer.from('cde')
      }
      expect(await s.put(key, parts(), { contentType: 'application/zip' })).toEqual({ size: 5 })
      const found = await s.get(key)
      expect(found?.contentType).toBe('application/zip')
      await read(found?.body ?? [])
      expect((await bytesOf(s, key)).toString()).toBe('abcde')
    })

    test('missing key returns null and delete is idempotent', async () => {
      const s = await fresh()
      const key = `users/${u1}/avatar/none.webp`
      expect(await s.get(key)).toBeNull()
      await expect(s.delete(key)).resolves.toBeUndefined()
      await s.put(key, bytes, webp)
      await s.delete(key)
      await s.delete(key)
      expect(await s.get(key)).toBeNull()
    })

    test('deletePrefix removes only that prefix', async () => {
      const s = await fresh()
      await s.put(`users/${u1}/avatar/a.webp`, bytes, webp)
      await s.put(`users/${u2}/avatar/b.webp`, bytes, webp)
      expect(await s.deletePrefix(`users/${u1}/`)).toBe(1)
      expect(await s.get(`users/${u1}/avatar/a.webp`)).toBeNull()
      expect(await exists(s, `users/${u2}/avatar/b.webp`)).toBe(true)
      expect(await s.deletePrefix(`users/${u1}/`)).toBe(0)
    })

    test('list returns the objects under a prefix in key order', async () => {
      const s = await fresh()
      await s.put(`org/${u1}/b.bin`, bytes, webp)
      await s.put(`org/${u1}/a/c.bin`, bytes, webp)
      await s.put(`org/${u2}/z.bin`, bytes, webp)
      const listed = await s.list(`org/${u1}/`)
      expect(listed.map((o) => o.key)).toEqual([`org/${u1}/a/c.bin`, `org/${u1}/b.bin`])
      expect(listed[0]).toMatchObject({ size: bytes.length, modifiedAt: expect.any(Date) as Date })
      expect(await s.list(`org/${u1}/nothing/`)).toEqual([])
    })

    test.each([
      '../etc/passwd',
      `users/${u1}/../../x`,
      'users/not-a-uuid/x',
      `users/${u1}//x`,
      '/abs/path',
    ])('rejects key %s', async (key) => {
      const s = await fresh()
      await expect(s.put(key, bytes, webp)).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(s.get(key)).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(s.delete(key)).rejects.toMatchObject({ code: 'VALIDATION' })
    })

    test.each([
      `users/${u1}x/a.bin`,
      `org/${u1}`,
      `users/${u1.toUpperCase()}/a.bin`,
      `users/${u1}/.hidden.tmp`,
      `users/${u1}/A.bin`,
    ])('rejects key %s (second group)', async (key) => {
      const s = await fresh()
      await expect(s.put(key, bytes, webp)).rejects.toMatchObject({ code: 'VALIDATION' })
    })

    test('does not confuse owners that share a leading id', async () => {
      const s = await fresh()
      await s.put(`users/${u1}/a.bin`, bytes, webp)
      expect(await s.list(`users/${u2}/`)).toEqual([])
      expect(await s.deletePrefix(`users/${u2}/`)).toBe(0)
      expect(await exists(s, `users/${u1}/a.bin`)).toBe(true)
    })

    test('a key that is a folder is not an object', async () => {
      const s = await fresh()
      await s.put(`users/${u1}/avatar/a.webp`, bytes, webp)
      expect(await s.get(`users/${u1}/avatar`)).toBeNull()
      await expect(s.delete(`users/${u1}/avatar`)).resolves.toBeUndefined()
      expect(await exists(s, `users/${u1}/avatar/a.webp`)).toBe(true)
      await expect(s.put(`users/${u1}/avatar`, bytes, webp)).rejects.toMatchObject({
        code: 'VALIDATION',
      })
      await expect(s.put(`users/${u1}/avatar/a.webp/b`, bytes, webp)).rejects.toMatchObject({
        code: 'VALIDATION',
      })
    })

    test('concurrent puts to one key leave data and type of the same write', async () => {
      const s = await fresh()
      const key = `users/${u1}/race.bin`
      const writes = Array.from({ length: 20 }, (_, i) =>
        s.put(key, Buffer.from(`write-${String(i)}`), { contentType: `text/x-${String(i)}` }),
      )
      await Promise.all(writes)
      const found = await s.get(key)
      const data = (await read(found?.body ?? [])).toString()
      expect(`text/x-${data.replace('write-', '')}`).toBe(found?.contentType)
    })

    test('a content type with control characters is rejected', async () => {
      const s = await fresh()
      await expect(
        s.put(`users/${u1}/a.bin`, bytes, { contentType: 'text/plain\nx' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    })

    test('lists in byte order', async () => {
      const s = await fresh()
      for (const name of ['a_b', 'a-b', 'a.b', 'a0'])
        await s.put(`users/${u1}/${name}`, bytes, webp)
      expect((await s.list(`users/${u1}/`)).map((o) => o.key.split('/')[2])).toEqual([
        'a-b',
        'a.b',
        'a0',
        'a_b',
      ])
    })

    test('rejects a prefix that is not an owner folder', async () => {
      const s = await fresh()
      await expect(s.deletePrefix('users/')).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(s.list('')).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(s.deletePrefix(`users/${u1}/../`)).rejects.toMatchObject({ code: 'VALIDATION' })
    })

    test('a crash during put leaves no partial object', async () => {
      const s = await fresh()
      const key = `users/${u1}/avatar/broken.webp`
      async function* failing() {
        yield Buffer.from('meta')
        await Promise.resolve()
        throw new Error('stream interrotto')
      }
      await expect(s.put(key, failing(), webp)).rejects.toThrow('stream interrotto')
      expect(await s.get(key)).toBeNull()
      expect(await s.list(`users/${u1}/`)).toEqual([])
    })

    test('a failed overwrite keeps the previous object', async () => {
      const s = await fresh()
      const key = `users/${u1}/avatar/keep.webp`
      await s.put(key, bytes, webp)
      async function* failing() {
        yield Buffer.from('x')
        await Promise.resolve()
        throw new Error('boom')
      }
      await expect(s.put(key, failing(), webp)).rejects.toThrow('boom')
      expect(await bytesOf(s, key)).toEqual(bytes)
    })
  })
}
