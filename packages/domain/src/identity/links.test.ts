import { expect, test } from 'vitest'
import { LINK_TTL_MS } from './links.js'

test('link lifetimes', () => {
  expect(LINK_TTL_MS).toEqual({
    bootstrap: 3600_000,
    invite: 72 * 3600_000,
    organization_owner: 3600_000,
  })
})
