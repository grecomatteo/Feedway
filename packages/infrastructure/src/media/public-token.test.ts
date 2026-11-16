import { expect, test } from 'vitest'
import { PUBLIC_TOKEN_LENGTH } from '@app/domain'
import { newPublicToken } from './public-token.js'

test('a public token is 32 url-safe characters', () => {
  expect(PUBLIC_TOKEN_LENGTH).toBe(32)
  for (let i = 0; i < 100; i++) expect(newPublicToken()).toMatch(/^[A-Za-z0-9_-]{32}$/)
})

test('a public token is random: never repeated, nothing in common between two', () => {
  const tokens = Array.from({ length: 1000 }, () => newPublicToken())
  expect(new Set(tokens).size).toBe(tokens.length)
  // 192 random bits: a shared prefix of 8 characters (48 bits) would not happen by chance
  expect(new Set(tokens.map((t) => t.slice(0, 8))).size).toBe(tokens.length)
})

test('a public token takes nothing from the file it names', () => {
  // it is made without any input: the media id (a UUID v7, partly a time) cannot lead to it
  expect(newPublicToken.length).toBe(0)
  const id = '019a8c2e-1d4f-7a3b-9c5d-2e6f8a1b3c4d'
  const compact = id.replaceAll('-', '')
  for (let i = 0; i < 100; i++) {
    const token = newPublicToken()
    expect(token).not.toContain(compact.slice(0, 8))
    expect(Buffer.from(token, 'base64url').toString('hex')).not.toContain(compact.slice(0, 8))
  }
})
