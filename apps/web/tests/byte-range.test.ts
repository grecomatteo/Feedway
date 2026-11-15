import { expect, test } from 'vitest'
import { parseByteRange } from '../server/utils/byte-range.js'

// HTTP Range for the panel's media (plan 04 Task 8): one range of bytes, or the whole file.

test('one range, open or closed, or the last bytes', () => {
  expect(parseByteRange('bytes=0-99')).toEqual({ start: 0, end: 99 })
  expect(parseByteRange('bytes=100-')).toEqual({ start: 100, end: null })
  expect(parseByteRange('bytes=-500')).toEqual({ suffix: 500 })
  expect(parseByteRange(' bytes = 5 - 9 ')).toEqual({ start: 5, end: 9 })
})

test('no header, or one that is not a single valid range, is the whole file', () => {
  for (const header of [
    undefined,
    '',
    'bytes=',
    'bytes=-',
    'bytes=9-5',
    'bytes=-0',
    'bytes=0-1,5-9',
    'items=0-9',
    'bytes=a-b',
    'bytes=1.5-9',
    `bytes=0-${'9'.repeat(20)}`,
  ])
    expect(parseByteRange(header), String(header)).toBeNull()
})
