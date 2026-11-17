import { expect, test } from 'vitest'
import { suggestType } from './suggest-type.js'

test.each([
  [[], null],
  [['image'], 'photo'],
  [['image', 'image'], 'carousel'],
  [['video'], 'reel'],
  [['video', 'image'], 'carousel'],
] as const)('%j is proposed as %s', (kinds, type) => {
  expect(suggestType(kinds.map((kind) => ({ kind })))).toBe(type)
})
