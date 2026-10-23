import { expect, test } from 'vitest'
import { mergeSettings, organizationName } from './settings.js'

const privacy = { controllerName: 'Agenzia A', contactEmail: 'privacy@a.it' }

test('patch keys replace current ones, others are kept', () => {
  expect(mergeSettings({ require2fa: 'admins', privacy }, { require2fa: 'all' })).toEqual({
    require2fa: 'all',
    privacy,
  })
})

test('privacy is replaced as a whole', () => {
  const next = { controllerName: 'Agenzia B', contactEmail: 'dpo@b.it' }
  expect(mergeSettings({ privacy: { ...privacy, extraText: 'x' } }, { privacy: next })).toEqual({
    privacy: next,
  })
})

test('merge does not mutate the inputs', () => {
  const current = { require2fa: 'admins' as const }
  mergeSettings(current, { require2fa: 'all' })
  expect(current).toEqual({ require2fa: 'admins' })
})

test('an agency name is trimmed and has 2 to 80 characters', () => {
  expect(organizationName('  Agenzia Bianchi  ')).toBe('Agenzia Bianchi')
  expect(organizationName('L’Agenzia')).toBe('L’Agenzia')
  expect(organizationName('A')).toBeNull()
  expect(organizationName('   ')).toBeNull()
  expect(organizationName('è'.repeat(80))).toBe('è'.repeat(80))
  expect(organizationName('è'.repeat(81))).toBeNull()
})

test('an agency name has no control characters', () => {
  expect(organizationName('Agenzia\nBianchi')).toBeNull()
  expect(organizationName('Agenzia\u0000')).toBeNull()
})
