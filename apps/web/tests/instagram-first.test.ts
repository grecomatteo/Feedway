import { describe, expect, it } from 'vitest'
import { instagramFirst } from '../app/utils/instagram-first.ts'

describe('instagramFirst', () => {
  it('puts the profiles with an Instagram first and keeps the order otherwise', () => {
    const page = { key: 'page', accounts: [{ platform: 'facebook' }] }
    const both = { key: 'both', accounts: [{ platform: 'facebook' }, { platform: 'instagram' }] }
    const other = { key: 'other', accounts: [{ platform: 'facebook' }] }
    const ig = { key: 'ig', accounts: [{ platform: 'instagram' }] }
    expect(instagramFirst([page, both, other, ig]).map((p) => p.key)).toEqual([
      'both',
      'ig',
      'page',
      'other',
    ])
  })
})
