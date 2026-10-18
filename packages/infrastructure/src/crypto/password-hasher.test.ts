import { expect, test } from 'vitest'
import { createPasswordHasher } from './password-hasher.js'

const hasher = createPasswordHasher()

test('argon2id params', async () => {
  const h = await hasher.hash('una-password-lunga')
  expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
  expect(await hasher.verify(h, 'una-password-lunga')).toBe(true)
  expect(await hasher.verify(h, 'altra')).toBe(false)
})

test('a malformed hash verifies as false instead of throwing', async () => {
  expect(await hasher.verify('not-a-hash', 'x')).toBe(false)
})
