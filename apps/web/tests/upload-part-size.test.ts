import { expect, test } from 'vitest'
import { UPLOAD_PART_MAX_BYTES } from '@app/contracts'
import { UPLOAD_PART_BYTES } from '@app/domain'
import { PART_BYTES } from '../app/utils/upload-file.ts'

// The route refuses a piece over the contract's limit: it must be the size the server asks for,
// or it would refuse the pieces it asked for (nuxt.config.ts takes the same constant).
test('the contract takes pieces of the size the domain cuts', () => {
  expect(UPLOAD_PART_MAX_BYTES).toBe(UPLOAD_PART_BYTES)
})

// the panel hashes the first piece before it asks the server anything
test('the panel cuts the first piece as the server will', () => {
  expect(PART_BYTES).toBe(UPLOAD_PART_BYTES)
})
