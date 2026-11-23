import { expect, test } from 'vitest'
import { nextUploads } from '../app/utils/upload-queue.ts'

// Two files go at once; a big video must not keep the small files waiting (D-120.7).
const MB = 1024 * 1024
const file = (key: string, mb: number, state = 'queued') => ({ key, size: mb * MB, state })

test('in their order while nothing big is on its way', () => {
  expect(nextUploads([file('a', 1), file('b', 2), file('c', 3)], 2)).toEqual(['a', 'b'])
})

test('a big video on its way: the other place goes to the first small file waiting', () => {
  const items = [file('v1', 200, 'uploading'), file('v2', 180), file('p1', 3), file('p2', 1)]
  expect(nextUploads(items, 2)).toEqual(['p1'])
})

test('two big videos first in the list: the first goes, the second place to a photo', () => {
  const items = [file('v1', 200), file('v2', 180), file('p1', 3)]
  expect(nextUploads(items, 2)).toEqual(['v1', 'p1'])
})

test('only big files waiting: they go in their order', () => {
  const items = [file('v1', 200, 'uploading'), file('v2', 180), file('v3', 150)]
  expect(nextUploads(items, 2)).toEqual(['v2'])
})

test('no place: nothing starts', () => {
  const items = [file('a', 1, 'hashing'), file('b', 1, 'completing'), file('c', 1)]
  expect(nextUploads(items, 2)).toEqual([])
})
