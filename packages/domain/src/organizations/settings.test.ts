import { expect, test } from 'vitest'
import {
  checkOrganizationName,
  checkPrivacySettings,
  mergeSettings,
  organizationName,
} from './settings.js'

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

test('an agency or workspace name is a name: no links, no control or direction characters', () => {
  for (const bad of [
    'https://truffa.example',
    'Agenzia www.truffa.example',
    'Agenzia http:truffa',
    'Agenzia\u202Eaizenga',
  ])
    expect(checkOrganizationName(bad), bad).toEqual({ ok: false, reason: 'INVALID' })
  expect(checkOrganizationName('A')).toEqual({ ok: false, reason: 'LENGTH' })
  expect(checkOrganizationName(' Agenzia 2.0 ')).toEqual({ ok: true, value: 'Agenzia 2.0' })
  expect(organizationName('https://truffa.example')).toBeNull()
})

test('the privacy controller data is checked and trimmed', () => {
  expect(
    checkPrivacySettings({
      controllerName: '  Rossi S.r.l. ',
      contactEmail: ' Privacy@Rossi.IT ',
      extraText: '  Responsabile: Mario Rossi.\nTelefono 02 1234  ',
    }),
  ).toEqual({
    ok: true,
    value: {
      controllerName: 'Rossi S.r.l.',
      contactEmail: 'privacy@rossi.it',
      extraText: 'Responsabile: Mario Rossi.\nTelefono 02 1234',
    },
  })
  // an empty extra text is no extra text
  expect(
    checkPrivacySettings({ controllerName: 'Rossi', contactEmail: 'a@b.it', extraText: ' ' }),
  ).toEqual({ ok: true, value: { controllerName: 'Rossi', contactEmail: 'a@b.it' } })
  const refused = (input: Parameters<typeof checkPrivacySettings>[0]) => {
    const r = checkPrivacySettings(input)
    return r.ok ? null : r.field
  }
  expect(refused({ controllerName: 'R', contactEmail: 'a@b.it' })).toBe('privacy.controllerName')
  expect(refused({ controllerName: 'https://x.it', contactEmail: 'a@b.it' })).toBe(
    'privacy.controllerName',
  )
  expect(refused({ controllerName: 'Rossi', contactEmail: 'non-un-indirizzo' })).toBe(
    'privacy.contactEmail',
  )
  expect(
    refused({ controllerName: 'Rossi', contactEmail: 'a@b.it', extraText: 'x'.repeat(2001) }),
  ).toBe('privacy.extraText')
  expect(refused({ controllerName: 'Rossi', contactEmail: 'a@b.it', extraText: 'a‮b' })).toBe(
    'privacy.extraText',
  )
})
