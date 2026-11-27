import { expect, test } from 'vitest'
import {
  isInstagramUsername,
  normalizeCollaborator,
  repeatedCollaborator,
} from './collaborators.js'

test('an Instagram username takes letters, digits, dot and underscore, up to 30 (D-125)', () => {
  expect(isInstagramUsername('forno.luce')).toBe(true)
  expect(isInstagramUsername('forno_luce_2026')).toBe(true)
  expect(isInstagramUsername('a'.repeat(30))).toBe(true)
  expect(isInstagramUsername('a'.repeat(31))).toBe(false)
  expect(isInstagramUsername('@forno')).toBe(false)
  expect(isInstagramUsername('forno luce')).toBe(false)
  expect(isInstagramUsername('forno-luce')).toBe(false)
  expect(isInstagramUsername('')).toBe(false)
  // Instagram refuses a dot at the start, at the end or twice in a row
  expect(isInstagramUsername('.forno')).toBe(false)
  expect(isInstagramUsername('forno.')).toBe(false)
  expect(isInstagramUsername('forno..luce')).toBe(false)
})

test('the editor drops spaces and the «@» and writes small letters', () => {
  expect(normalizeCollaborator('  @Forno.Luce ')).toBe('forno.luce')
  expect(normalizeCollaborator('@@forno')).toBe('forno')
})

test('a name given twice is found whatever its case', () => {
  expect(repeatedCollaborator(['forno', 'luce'])).toBeNull()
  expect(repeatedCollaborator(['forno', 'luce', 'Forno'])).toBe('Forno')
})
