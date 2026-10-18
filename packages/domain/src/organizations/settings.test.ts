import { expect, test } from 'vitest'
import { mergeSettings } from './settings.js'

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
