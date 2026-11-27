import { randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { createGridPictureTokens } from './grid-pictures.js'

const tokens = createGridPictureTokens(randomBytes(32))
const now = new Date('2026-11-27T10:00:00Z')
const later = (ms: number) => new Date(now.getTime() + ms)
const scope = { organizationId: 'org-a', accountId: 'account-a' }
const picture = {
  mediaId: '17900000000000012',
  pictureUrl: 'https://scontent.cdninstagram.com/v/t51/1.jpg?oh=0a0a&oe=6B00',
}

test('a token opens to its picture, on its account, until it expires', () => {
  const token = tokens.seal(scope, picture, later(300_000))
  expect(tokens.open(scope, token, now)).toEqual(picture)
  expect(tokens.open(scope, token, later(299_999))).toEqual(picture)
  expect(tokens.open(scope, token, later(300_000))).toBeNull()
})

test('the address of the picture is not readable in the token', () => {
  const token = tokens.seal(scope, picture, later(300_000))
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain('cdninstagram')
  // a new token each time: two of the same picture do not tell they are the same
  expect(tokens.seal(scope, picture, later(300_000))).not.toBe(token)
})

test('another account, another agency or another key does not open it', () => {
  const token = tokens.seal(scope, picture, later(300_000))
  expect(tokens.open({ ...scope, accountId: 'account-b' }, token, now)).toBeNull()
  expect(tokens.open({ ...scope, organizationId: 'org-b' }, token, now)).toBeNull()
  expect(createGridPictureTokens(randomBytes(32)).open(scope, token, now)).toBeNull()
})

test('a token changed by one byte, cut, or not one of ours does not open', () => {
  const token = tokens.seal(scope, picture, later(300_000))
  const bytes = Buffer.from(token, 'base64url')
  for (const at of [0, 12, bytes.length - 1]) {
    const changed = Buffer.from(bytes)
    changed[at] = (changed[at] ?? 0) ^ 1
    expect(tokens.open(scope, changed.toString('base64url'), now)).toBeNull()
  }
  expect(tokens.open(scope, token.slice(0, -4), now)).toBeNull()
  // the same bytes in another spelling: one valid form only
  expect(tokens.open(scope, `${token}=`, now)).toBeNull()
  for (const bad of ['', 'x', 'a'.repeat(5000), '..%2Fme', '1790000000000001'])
    expect(tokens.open(scope, bad, now)).toBeNull()
})
