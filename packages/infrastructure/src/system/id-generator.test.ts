import { expect, test } from 'vitest'
import { uuidV7Generator } from './id-generator.js'

test('uuid v7 ids are time ordered', async () => {
  const a = uuidV7Generator.newId()
  await new Promise((r) => setTimeout(r, 2))
  const b = uuidV7Generator.newId()
  expect(a).toMatch(/^[0-9a-f-]{36}$/)
  expect(a < b).toBe(true)
})
