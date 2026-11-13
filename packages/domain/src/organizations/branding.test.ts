import { expect, test } from 'vitest'
import { logoUrl } from './branding.js'

test('the logo is served from the panel, named by the hash of its file', () => {
  expect(logoUrl('forno-luce', 'org/0190/logo/ab12')).toBe(
    '/api/v1/orgs/forno-luce/logo/256?v=ab12',
  )
  expect(logoUrl('forno-luce', null)).toBeNull()
})
