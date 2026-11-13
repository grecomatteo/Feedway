import { expect, test } from 'vitest'
import { LOGO_MAX_BYTES, LOGO_MIN_SIDE, logoUrl } from './branding.js'

test('the logo is served from the panel, named by the hash of its file', () => {
  expect(logoUrl('forno-luce', 'org/0190/logo/ab12')).toBe(
    '/api/v1/orgs/forno-luce/logo/256?v=ab12',
  )
  expect(logoUrl('forno-luce', null)).toBeNull()
})

test('limits of the logo: as the profile photo, but a logo may be thin', () => {
  expect(LOGO_MAX_BYTES).toBe(5 * 1024 * 1024)
  expect(LOGO_MIN_SIDE).toBe(16)
})
