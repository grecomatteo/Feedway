import { expect, test } from 'vitest'
import { metaBusinessUrl } from '../app/utils/meta-business-url.ts'

test('opens the agency Business Manager when its id is known', () => {
  expect(metaBusinessUrl('system-users', '3000000000000001')).toBe(
    'https://business.facebook.com/settings/system-users?business_id=3000000000000001',
  )
})

test('without an id Meta asks which business to open', () => {
  expect(metaBusinessUrl('system-users', null)).toBe(
    'https://business.facebook.com/settings/system-users',
  )
})

test('an id that is not a Meta id is left out', () => {
  expect(metaBusinessUrl('partners', '12&x=1')).toBe(
    'https://business.facebook.com/settings/partners',
  )
})
