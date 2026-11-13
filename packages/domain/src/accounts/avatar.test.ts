import { expect, test } from 'vitest'
import { accountAvatarUrl, profilePhotoAccount } from './avatar.js'

test('the address of a stored picture is in the panel, with its hash against stale caches', () => {
  expect(
    accountAvatarUrl(
      'forno-luce',
      '0190aaaa-0000-7000-8000-000000000001',
      'org/0190/accounts/x/avatar/ab12',
    ),
  ).toBe('/api/v1/orgs/forno-luce/accounts/0190aaaa-0000-7000-8000-000000000001/avatar/256?v=ab12')
  expect(accountAvatarUrl('forno-luce', '0190aaaa-0000-7000-8000-000000000001', null)).toBeNull()
})

test("a profile's photo is its Instagram's, else its Page's, else none", () => {
  const ig = { platform: 'instagram' as const, avatarKey: 'k-ig' }
  const fb = { platform: 'facebook' as const, avatarKey: 'k-fb' }
  expect(profilePhotoAccount([fb, ig])).toBe(ig)
  expect(profilePhotoAccount([fb, { ...ig, avatarKey: null }])).toBe(fb)
  expect(profilePhotoAccount([{ ...fb, avatarKey: null }])).toBeNull()
})
