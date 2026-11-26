import { expect, test } from 'vitest'
import { isGridMediaId, isGridPost, isGridWaiting } from './grid.js'

test('photos, carousels and reels shown in the feed reach the grid; stories never', () => {
  expect(isGridPost({ type: 'photo', shareToFeed: false })).toBe(true)
  expect(isGridPost({ type: 'carousel', shareToFeed: false })).toBe(true)
  expect(isGridPost({ type: 'reel', shareToFeed: true })).toBe(true)
  expect(isGridPost({ type: 'reel', shareToFeed: false })).toBe(false)
  expect(isGridPost({ type: 'story', shareToFeed: true })).toBe(false)
})

test('a media id of the address is digits only', () => {
  expect(isGridMediaId('17900000000000012')).toBe(true)
  for (const bad of ['', '12a', '1/2', '1,2', '../1', '1'.repeat(33)])
    expect(isGridMediaId(bad)).toBe(false)
})

test('a destination still to go out keeps its post among the scheduled', () => {
  for (const s of ['scheduled', 'preparing', 'ready', 'publishing', 'retrying', 'paused'] as const)
    expect(isGridWaiting(s)).toBe(true)
  for (const s of [
    'draft',
    'published',
    'verifying',
    'confirmed',
    'unknown',
    'problem',
    'failed',
    'cancelled',
  ] as const)
    expect(isGridWaiting(s)).toBe(false)
})
