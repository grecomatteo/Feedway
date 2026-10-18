import { expect, test } from 'vitest'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_PIXELS,
  AVATAR_SIZES,
  displayName,
  initials,
  validateCrop,
  validateNickname,
} from './profile.js'

test('nickname is trimmed, empty becomes null, max 30 graphemes', () => {
  expect(validateNickname('  Teo  ')).toEqual({ ok: true, value: 'Teo' })
  expect(validateNickname('   ')).toEqual({ ok: true, value: null })
  expect(validateNickname(null)).toEqual({ ok: true, value: null })
  expect(validateNickname('👩‍💻'.repeat(30)).ok).toBe(true)
  expect(validateNickname('a'.repeat(30)).ok).toBe(true)
  expect(validateNickname('a'.repeat(31))).toEqual({ ok: false, reason: 'TOO_LONG' })
})
test('display name prefers nickname', () => {
  expect(displayName({ name: 'Matteo Greco', nickname: 'Teo' })).toBe('Teo')
  expect(displayName({ name: 'Matteo Greco', nickname: null })).toBe('Matteo Greco')
})
test('initials', () => {
  expect(initials('Matteo Greco')).toBe('MG')
  expect(initials('  anna  maria rossi ')).toBe('AR')
  expect(initials('Zoë')).toBe('ZO')
  expect(initials('Élodie')).toBe('ÉL')
  expect(initials('')).toBe('?')
})
test('avatar limits', () => {
  expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024)
  expect(AVATAR_MAX_PIXELS).toBe(40_000_000)
  expect(AVATAR_SIZES).toEqual([256, 64])
})
test('crop must be a square inside the image', () => {
  expect(validateCrop({ x: 0, y: 0, size: 500 }, { width: 800, height: 500 })).toBe(true)
  expect(validateCrop({ x: 300, y: 0, size: 500 }, { width: 800, height: 500 })).toBe(true)
  expect(validateCrop({ x: 400, y: 0, size: 500 }, { width: 800, height: 500 })).toBe(false)
  expect(validateCrop({ x: 0, y: 1, size: 500 }, { width: 800, height: 500 })).toBe(false)
  expect(validateCrop({ x: -1, y: 0, size: 100 }, { width: 800, height: 500 })).toBe(false)
  expect(validateCrop({ x: 0, y: 0, size: 32 }, { width: 800, height: 500 })).toBe(false)
  expect(validateCrop({ x: 0.5, y: 0, size: 100 }, { width: 800, height: 500 })).toBe(false)
})
