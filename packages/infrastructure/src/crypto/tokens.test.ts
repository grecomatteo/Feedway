import { expect, test } from 'vitest'
import { createTokenService } from './tokens.js'

const tokens = createTokenService()

test('tokens are 32 random bytes in base64url and hashed with sha-256', () => {
  const { token, hash } = tokens.generate()
  expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(hash).toHaveLength(32)
  expect(tokens.hash(token)).toEqual(hash)
})

test('every token is different', () => {
  expect(tokens.generate().token).not.toBe(tokens.generate().token)
})
