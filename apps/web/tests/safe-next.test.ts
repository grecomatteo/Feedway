import { expect, test } from 'vitest'
import { safeNext } from '../app/utils/safe-next.ts'

test.each([
  ['/account/sicurezza', '/account/sicurezza'],
  ['/agenzia?spazio=a#x', '/agenzia?spazio=a#x'],
])('keeps the panel path %s', (value, expected) => {
  expect(safeNext(value)).toBe(expected)
})

test.each([
  'https://evil.example',
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  '/%09/evil.example'.replace('%09', '\t'),
  '/\n/evil.example',
  'javascript:alert(1)',
  '/api/auth/sign-out',
  '',
  42,
  undefined,
])('refuses %s', (value) => {
  expect(safeNext(value)).toBeNull()
})
