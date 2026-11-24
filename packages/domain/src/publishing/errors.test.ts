import { describe, expect, it } from 'vitest'
import { PUBLISH_ERROR_CODES, publishErrorCodeOfMeta, publishErrorMessage } from './errors.js'

describe('publishErrorCodeOfMeta (the table of §9.5)', () => {
  it.each([
    [190, 'token_invalid'],
    [200, 'permission_missing'],
    [10, 'permission_missing'],
    [9007, 'media_processing'],
    [9004, 'media_rejected'],
    [2207026, 'media_rejected'],
    [506, 'duplicate'],
    [4, 'rate_limited'],
    [17, 'rate_limited'],
    [32, 'rate_limited'],
    [613, 'rate_limited'],
    [341, 'rate_limited'],
    [80001, 'rate_limited'],
    [80002, 'rate_limited'],
  ] as const)('%i → %s', (meta, code) => {
    expect(publishErrorCodeOfMeta(meta)).toBe(code)
  })
  it('a file Meta could not download is not a wrong file (D-131.2)', () => {
    expect(publishErrorCodeOfMeta(9004, 2207052)).toBe('media_unreachable')
    expect(publishErrorCodeOfMeta(389)).toBe('media_unreachable')
  })
  it('a code not in the table, or none, is a generic Meta error', () => {
    expect(publishErrorCodeOfMeta(1)).toBe('meta_error')
    expect(publishErrorCodeOfMeta(null)).toBe('meta_error')
  })
  it('Instagram error subcodes travel as Meta codes too', () => {
    expect(publishErrorCodeOfMeta(100, 2207026)).toBe('media_rejected')
  })
  // Instagram Error Codes (docs/platforms/meta.md §Pubblicazione), not verified on Meta
  it.each([
    [9007, 2207027, 'media_processing'],
    [9004, 2207052, 'media_unreachable'],
    [352, 2207026, 'media_rejected'],
    [36000, 2207004, 'media_rejected'],
    [36001, 2207005, 'media_rejected'],
    [36003, 2207009, 'media_rejected'],
    [9, 2207042, 'quota_exhausted'],
    [25, 2207050, 'account_restricted'],
  ] as const)('Instagram %i/%i → %s', (meta, subcode, code) => {
    expect(publishErrorCodeOfMeta(meta, subcode)).toBe(code)
  })
})

describe('publishErrorMessage', () => {
  it('is a translation key for every code', () => {
    for (const code of PUBLISH_ERROR_CODES)
      expect(publishErrorMessage(code)).toBe(`publishing.errors.${code}`)
  })
  it('has the codes Feedway gives on its own', () => {
    for (const code of [
      'too_late',
      'uncertain_not_found',
      'file_wont_publish',
      'author_lost_permission',
      'organization_suspended',
    ])
      expect(PUBLISH_ERROR_CODES).toContain(code)
  })
})
