import { describe, expect, test, vi } from 'vitest'
import type { PublicVariantRecord } from '../ports/media.js'
import type { Storage } from '../ports/storage.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { readPublicMediaFile } from './public-file.js'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012-_9'

const photo: PublicVariantRecord = {
  id: '019a8c2e-1d4f-7a3b-9c5d-2e6f8a1b3c4d',
  organizationId: '019a8c2e-0000-7000-8000-000000000001',
  storageKey: 'org/019a8c2e-0000-7000-8000-000000000001/media/x/ig_feed.jpg',
  mime: 'image/jpeg',
  sizeBytes: 1000,
}

function world(found: PublicVariantRecord | null = photo) {
  const findPublicVariant = vi.fn((token: string) => Promise.resolve(token ? found : null))
  const runAsSystem = vi.fn((_reason: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ media: { findPublicVariant } }),
  )
  const uow = {
    run: () => {
      throw new Error('the public host has no agency scope')
    },
    runAsSystem,
  } as unknown as UnitOfWork
  const body = (async function* () {
    await Promise.resolve()
    yield new Uint8Array([1, 2, 3])
  })()
  const get = vi.fn(() => Promise.resolve({ body, size: 1000, contentType: 'image/jpeg' }))
  const getRange = vi.fn(() =>
    Promise.resolve({ body, size: 1000, contentType: 'image/jpeg', range: { start: 0, end: 9 } }),
  )
  const storage = { get, getRange } as unknown as Storage
  return { deps: { uow, storage }, runAsSystem, findPublicVariant, get, getRange }
}

describe('readPublicMediaFile', () => {
  test.each([
    ['a token of 31 characters', `${TOKEN.slice(1)}.jpg`],
    ['a token of 33 characters', `${TOKEN}A.jpg`],
    ['a character outside base64url', `${TOKEN.slice(1)}=.jpg`],
    ['another extension', `${TOKEN}.png`],
    ['an extension in capitals', `${TOKEN}.JPG`],
    ['no extension', TOKEN],
    ['two extensions', `${TOKEN}.jpg.mp4`],
    ['a path', `../${TOKEN}.jpg`],
    ['nothing', ''],
  ])('%s is not found, without asking the database', async (_, name) => {
    const w = world()
    expect(await readPublicMediaFile(w.deps, { name, range: null })).toBeNull()
    expect(w.runAsSystem).not.toHaveBeenCalled()
  })

  test('finds the copy by its token alone', async () => {
    const w = world()
    const file = await readPublicMediaFile(w.deps, { name: `${TOKEN}.jpg`, range: null })
    expect(w.findPublicVariant).toHaveBeenCalledWith(TOKEN)
    expect(file).toMatchObject({ kind: 'whole', contentType: 'image/jpeg', etag: photo.id })
    expect(w.get).toHaveBeenCalledWith(photo.storageKey)
  })

  test('an unknown token is not found', async () => {
    const w = world(null)
    expect(await readPublicMediaFile(w.deps, { name: `${TOKEN}.jpg`, range: null })).toBeNull()
    expect(w.get).not.toHaveBeenCalled()
  })

  test('the extension must match the copy: a photo is never served as .mp4', async () => {
    const w = world()
    expect(await readPublicMediaFile(w.deps, { name: `${TOKEN}.mp4`, range: null })).toBeNull()
    expect(w.get).not.toHaveBeenCalled()
  })

  test.each(['image/webp', 'video/quicktime', 'text/html'])(
    'a copy of type %s is never served',
    async (mime) => {
      const w = world({ ...photo, mime })
      for (const ext of ['jpg', 'mp4'])
        expect(
          await readPublicMediaFile(w.deps, { name: `${TOKEN}.${ext}`, range: null }),
        ).toBeNull()
      expect(w.get).not.toHaveBeenCalled()
    },
  )

  test('a video is served as .mp4', async () => {
    const w = world({ ...photo, mime: 'video/mp4' })
    expect(await readPublicMediaFile(w.deps, { name: `${TOKEN}.mp4`, range: null })).toMatchObject({
      contentType: 'video/mp4',
    })
  })

  test.each([
    [{ start: 10, end: 19 }, 10, 19],
    [{ start: 10, end: null }, 10, Number.MAX_SAFE_INTEGER],
    [{ suffix: 100 }, 900, Number.MAX_SAFE_INTEGER],
    [{ suffix: 5000 }, 0, Number.MAX_SAFE_INTEGER],
  ])('reads the range %j', async (range, start, end) => {
    const w = world()
    const file = await readPublicMediaFile(w.deps, { name: `${TOKEN}.jpg`, range })
    expect(file?.kind).toBe('part')
    expect(w.getRange).toHaveBeenCalledWith(photo.storageKey, start, end)
  })
})
