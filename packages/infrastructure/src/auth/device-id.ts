import { randomBytes } from 'node:crypto'

/** Random, no personal data: it only tells a known device from a new one (Task 11). */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 86_400

const DEVICE_ID = /^[A-Za-z0-9_-]{43}$/

export function newDeviceId(): string {
  return randomBytes(32).toString('base64url')
}

export function isDeviceId(value: string | undefined): value is string {
  return value !== undefined && DEVICE_ID.test(value)
}
