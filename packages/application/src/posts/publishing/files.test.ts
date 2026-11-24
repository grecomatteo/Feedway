import { describe, expect, test } from 'vitest'
import type { StoredObject } from '../../ports/storage.js'
import { coverOutcomeOf } from '../../ports/platform-publisher.js'
import { readCover } from './files.js'

// The bytes of a reel's cover for Facebook's `thumbnails` (plan 08 Task 11, D-120.9).

const stored = (parts: Uint8Array[], onClose?: () => void): StoredObject => ({
  size: parts.reduce((n, p) => n + p.byteLength, 0),
  contentType: 'image/jpeg',
  body: {
    async *[Symbol.asyncIterator]() {
      try {
        for (const p of parts) yield await Promise.resolve(p)
      } finally {
        onClose?.()
      }
    },
  },
})
const storage = (object: StoredObject | null, keys: string[] = []) => ({
  get: (key: string) => {
    keys.push(key)
    return Promise.resolve(object)
  },
})

describe('readCover', () => {
  test('the copy by its key, whole, with its type', async () => {
    const keys: string[] = []
    const cover = await readCover(
      storage(stored([new Uint8Array([1, 2]), new Uint8Array([3])]), keys),
      'org/o/copies/c.jpg',
    )
    expect(keys).toEqual(['org/o/copies/c.jpg'])
    expect(cover?.contentType).toBe('image/jpeg')
    expect([...(cover?.bytes ?? [])]).toEqual([1, 2, 3])
  })

  test('gone: null; beyond 10 MB: null, and the stream is closed', async () => {
    expect(await readCover(storage(null), 'k')).toBeNull()
    let closed = false
    const big = new Uint8Array(6 * 1024 * 1024)
    expect(
      await readCover(
        storage(
          stored([big, big, big], () => {
            closed = true
          }),
        ),
        'k',
      ),
    ).toBeNull()
    expect(closed).toBe(true)
  })
})

test('coverOutcomeOf reads only the values the publishers write', () => {
  expect(coverOutcomeOf({ cover: 'done' })).toBe('done')
  expect(coverOutcomeOf({ cover: 'no_permission' })).toBe('no_permission')
  expect(coverOutcomeOf({ cover: 'other' })).toBeNull()
  expect(coverOutcomeOf(null)).toBeNull()
  // still waiting for the verification: no outcome yet; past it, the cover never went up
  expect(coverOutcomeOf({ cover: 'pending' })).toBeNull()
  expect(coverOutcomeOf({ cover: 'pending' }, true)).toBe('failed')
  expect(coverOutcomeOf({ cover: 'done' }, true)).toBe('done')
})
