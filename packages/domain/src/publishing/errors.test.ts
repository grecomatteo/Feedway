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
  it('a code not in the table, or none, is a generic Meta error', () => {
    expect(publishErrorCodeOfMeta(1)).toBe('meta_error')
    expect(publishErrorCodeOfMeta(null)).toBe('meta_error')
  })
  it('Instagram error subcodes travel as Meta codes too', () => {
    expect(publishErrorCodeOfMeta(100, 2207026)).toBe('media_rejected')
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
