import { expect, test } from 'vitest'
import { loggablePath } from './log-path'

test('the token of an activation link never reaches the request log', () => {
  expect(loggablePath('/api/v1/links/abc-123_x/activate?x=1')).toBe('/api/v1/links/:token/activate')
  expect(loggablePath('/api/v1/links/abc')).toBe('/api/v1/links/:token')
  expect(loggablePath('/attiva/abc%2Fdef')).toBe('/attiva/:token')
})

test('other paths are logged as they are, without the query', () => {
  expect(loggablePath('/api/v1/me?debug=1')).toBe('/api/v1/me')
  expect(loggablePath('/agenzie/rossi/attiva')).toBe('/agenzie/rossi/attiva')
})
