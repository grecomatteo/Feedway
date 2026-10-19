import { expect, test } from 'vitest'
import { DEVICE_COOKIE_MAX_AGE_SECONDS, isDeviceId, newDeviceId } from './device-id.js'

test('a new device id is 32 random bytes in base64url', () => {
  const id = newDeviceId()
  expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(Buffer.from(id, 'base64url')).toHaveLength(32)
  expect(newDeviceId()).not.toBe(id)
})

test.each([undefined, '', 'forged', 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`])(
  '%s is not a device id',
  (value) => {
    expect(isDeviceId(value)).toBe(false)
  },
)

test('a generated id is accepted back', () => {
  expect(isDeviceId(newDeviceId())).toBe(true)
})

test('the cookie lives 400 days', () => {
  expect(DEVICE_COOKIE_MAX_AGE_SECONDS).toBe(400 * 86_400)
})
