import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { createSecretBox } from './secret-box.js'

const k1 = randomBytes(32)
const k2 = randomBytes(32)
const box = createSecretBox(new Map([[1, k1]]), 1)

const flipLastChar = (s: string) => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')
// flips one bit of the given part (2 = iv, 3 = ciphertext, 4 = tag) and re-encodes it canonically
const flipBit = (s: string, part: number) => {
  const parts = s.split('.')
  const bytes = Buffer.from(parts[part] ?? '', 'base64url')
  bytes[0] = (bytes[0] ?? 0) ^ 1
  parts[part] = bytes.toString('base64url')
  return parts.join('.')
}

describe('secret box', () => {
  test('seal/open roundtrip and tamper detection', () => {
    const s = box.seal('s3cr3t', 'aad')
    expect(box.open(s, 'aad')).toBe('s3cr3t')
    expect(() => box.open(flipLastChar(s), 'aad')).toThrow()
    expect(() => box.open(s, 'other')).toThrow()
    for (const part of [2, 3, 4])
      expect(() => box.open(flipBit(s, part), 'aad'), String(part)).toThrow()
  })

  test('format is v1.<keyVersion>.<iv>.<ciphertext>.<tag> in base64url', () => {
    const parts = box.seal('x', 'a').split('.')
    expect(parts).toHaveLength(5)
    expect(parts.slice(0, 2)).toEqual(['v1', '1'])
    expect(Buffer.from(parts[2] ?? '', 'base64url')).toHaveLength(12)
    expect(Buffer.from(parts[4] ?? '', 'base64url')).toHaveLength(16)
  })

  test('same plaintext seals differently every time (random iv)', () => {
    expect(box.seal('x', 'a')).not.toBe(box.seal('x', 'a'))
  })

  test('open picks the key from the version in the sealed text', () => {
    const old = box.seal('vecchio', 'a')
    const rotated = createSecretBox(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      2,
    )
    expect(rotated.open(old, 'a')).toBe('vecchio')
    expect(rotated.seal('nuovo', 'a')).toMatch(/^v1\.2\./)
  })

  test('unknown version, malformed text and wrong key are rejected', () => {
    const other = createSecretBox(new Map([[1, k2]]), 1)
    expect(() => other.open(box.seal('x', 'a'), 'a')).toThrow()
    expect(() => box.open('v1.9.a.b.c', 'a')).toThrow(/version/)
    expect(() => box.open('v2.1.a.b.c', 'a')).toThrow()
    expect(() => box.open('nonsense', 'a')).toThrow()
    // one canonical form only: a version with a leading zero is refused
    expect(() => box.open(box.seal('x', 'a').replace(/^v1\.1\./, 'v1.01.'), 'a')).toThrow()
  })

  test('keys must be 32 bytes and the active version must exist', () => {
    expect(() => createSecretBox(new Map([[1, randomBytes(16)]]), 1)).toThrow()
    expect(() => createSecretBox(new Map([[1, k1]]), 2)).toThrow()
  })

  test('unicode survives', () => {
    expect(box.open(box.seal('perché 👩‍💻', 'a'), 'a')).toBe('perché 👩‍💻')
  })
})
