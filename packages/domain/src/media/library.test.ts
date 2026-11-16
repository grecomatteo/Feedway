import { expect, test } from 'vitest'
import { DomainError } from '../errors.js'
import {
  FOLDER_MAX_DEPTH,
  MAX_TAGS,
  TAG_MAX_LENGTH,
  folderHeight,
  folderName,
  folderPath,
  folderWouldLoop,
  normalizeTags,
} from './library.js'

const refused = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other'
  }
  return null
}

test('a folder name is trimmed, its inner spaces kept single', () => {
  expect(folderName('  Natale   2026 ')).toBe('Natale 2026')
})

test('a folder name is 1 to 80 characters, with no slash nor control character', () => {
  expect(refused(() => folderName('   '))).toBe('VALIDATION')
  expect(refused(() => folderName('a'.repeat(81)))).toBe('VALIDATION')
  expect(refused(() => folderName('foto/vecchie'))).toBe('VALIDATION')
  expect(refused(() => folderName('foto\u0000'))).toBe('VALIDATION')
  expect(refused(() => folderName('a'.repeat(80)))).toBeNull()
})

test('tags are trimmed, lowercased and counted once, in the order given', () => {
  expect(normalizeTags([' Natale ', 'natale', 'Pane  fresco', 'NATALE'])).toEqual([
    'natale',
    'pane fresco',
  ])
})

test('an empty tag is dropped; a tag too long or with a control character is refused', () => {
  expect(normalizeTags(['', '  '])).toEqual([])
  expect(refused(() => normalizeTags(['a'.repeat(TAG_MAX_LENGTH + 1)]))).toBe('VALIDATION')
  expect(refused(() => normalizeTags(['a\nb']))).toBe('VALIDATION')
})

test(`a file holds at most ${String(MAX_TAGS)} tags`, () => {
  const many = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${String(i)}`)
  expect(refused(() => normalizeTags(many))).toBe('VALIDATION')
  expect(normalizeTags(many.slice(0, MAX_TAGS))).toHaveLength(MAX_TAGS)
})

const tree = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: null },
]

test('a folder cannot go inside itself nor inside one of its own folders', () => {
  expect(folderWouldLoop(tree, 'a', 'a')).toBe(true)
  expect(folderWouldLoop(tree, 'a', 'c')).toBe(true)
  expect(folderWouldLoop(tree, 'c', 'a')).toBe(false)
  expect(folderWouldLoop(tree, 'a', 'd')).toBe(false)
  expect(folderWouldLoop(tree, 'a', null)).toBe(false)
})

test(`folders nest ${String(FOLDER_MAX_DEPTH)} levels at most`, () => {
  expect(FOLDER_MAX_DEPTH).toBe(5)
})

test('the height of a folder counts the levels below it, itself included', () => {
  expect(folderHeight(tree, 'a')).toBe(3)
  expect(folderHeight(tree, 'c')).toBe(1)
  expect(folderPath(tree, 'c')).toEqual(['c', 'b', 'a'])
})
