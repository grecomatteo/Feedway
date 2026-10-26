import { createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { createSignedTokens } from './signed-tokens.js'

const key = randomBytes(32)
const signed = createSignedTokens(key)
const now = new Date('2026-10-18T10:00:00Z')
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000)
const tamper = (t: string) => {
  const [payload = '', mac = ''] = t.split('.')
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
  return `${Buffer.from(JSON.stringify({ ...body, u: 'u2' })).toString('base64url')}.${mac}`
}
const deviceIdA = randomBytes(32).toString('base64url')
const deviceIdB = randomBytes(32).toString('base64url')

test('signed security lock token expires and is bound to its purpose', () => {
  const t = signed.sign('security_lock', { userId: 'u1', issuedAt: now, expiresAt: inDays(7) })
  expect(signed.verify('security_lock', t, now)).toEqual({ userId: 'u1', issuedAt: now })
  expect(signed.verify('security_lock', t, inDays(8))).toBeNull()
  expect(signed.verify('security_lock', tamper(t), now)).toBeNull()
})

test('a token signed before issue dates were added has no issue date', () => {
  const legacy = (payload: object) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const mac = createHmac(
      'sha256',
      Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'feedway:signed:security_lock', 32)),
    )
      .update(body)
      .digest('base64url')
    return `${body}.${mac}`
  }
  expect(signed.verify('security_lock', legacy({ u: 'u1', e: inDays(7).getTime() }), now)).toEqual({
    userId: 'u1',
    issuedAt: null,
  })
  // an issue date that is not a number makes the token invalid, not undated
  expect(
    signed.verify('security_lock', legacy({ u: 'u1', e: inDays(7).getTime(), i: 'x' }), now),
  ).toBeNull()
  for (const i of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2])
    expect(
      signed.verify('security_lock', legacy({ u: 'u1', e: inDays(7).getTime(), i }), now),
    ).toBeNull()
})

test('a token signed with another key or malformed is rejected', () => {
  const other = createSignedTokens(randomBytes(32))
  const t = other.sign('security_lock', { userId: 'u1', issuedAt: now, expiresAt: inDays(7) })
  expect(signed.verify('security_lock', t, now)).toBeNull()
  const own = signed.sign('security_lock', { userId: 'u1', issuedAt: now, expiresAt: inDays(7) })
  const nonCanonical = own.slice(0, -1) + (own.endsWith('A') ? 'B' : 'A')
  for (const bad of ['', 'abc', 'a.b.c', `${t}x`, '.', 'e30.', nonCanonical, `${own}=`]) {
    expect(signed.verify('security_lock', bad, now)).toBeNull()
  }
})

test('device hash separates user and device ids unambiguously', () => {
  expect(signed.deviceHash('ab', 'c')).not.toEqual(signed.deviceHash('a', 'bc'))
})

test('device hash is stable per user and device id, different across users and devices', () => {
  expect(signed.deviceHash('u1', deviceIdA)).toEqual(signed.deviceHash('u1', deviceIdA))
  expect(signed.deviceHash('u2', deviceIdA)).not.toEqual(signed.deviceHash('u1', deviceIdA))
  expect(signed.deviceHash('u1', deviceIdB)).not.toEqual(signed.deviceHash('u1', deviceIdA))
  expect(createSignedTokens(randomBytes(32)).deviceHash('u1', deviceIdA)).not.toEqual(
    signed.deviceHash('u1', deviceIdA),
  )
})

test('address hash is keyed: equal for one address, different under another key', () => {
  const signed = createSignedTokens(randomBytes(32))
  expect(signed.addressHash('anna@example.test')).toEqual(signed.addressHash('anna@example.test'))
  expect(signed.addressHash('anna@example.test')).not.toEqual(
    signed.addressHash('bea@example.test'),
  )
  expect(createSignedTokens(randomBytes(32)).addressHash('anna@example.test')).not.toEqual(
    signed.addressHash('anna@example.test'),
  )
})
