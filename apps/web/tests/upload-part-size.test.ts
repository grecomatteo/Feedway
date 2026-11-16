import { expect, test } from 'vitest'
import { UPLOAD_PART_MAX_BYTES } from '@app/contracts'
import { UPLOAD_PART_BYTES } from '@app/domain'

// The route refuses a piece over the contract's limit: it must be the size the server asks for,
// or it would refuse the pieces it asked for (nuxt.config.ts takes the same constant).
test('the contract takes pieces of the size the domain cuts', () => {
  expect(UPLOAD_PART_MAX_BYTES).toBe(UPLOAD_PART_BYTES)
})
