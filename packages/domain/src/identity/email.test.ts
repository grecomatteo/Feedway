import { expect, test } from 'vitest'
import { normalizeEmail } from './email.js'

test('an email is trimmed and lowercased: one identity whatever the spelling', () => {
  expect(normalizeEmail('  Utente@AgenziaB.it ')).toBe('utente@agenziab.it')
})

test('something that is not an address is refused', () => {
  for (const raw of [
    '',
    'non-una-email',
    '@esempio.it',
    'a@',
    'a@b',
    'a b@esempio.it',
    'a@@esempio.it',
  ])
    expect(normalizeEmail(raw)).toBeNull()
  expect(normalizeEmail(`${'a'.repeat(250)}@esempio.it`)).toBeNull()
})
