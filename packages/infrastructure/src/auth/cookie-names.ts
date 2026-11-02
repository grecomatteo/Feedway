/**
 * Names with the `__Host-` prefix: the browser then accepts them only over https, without a
 * Domain attribute and with Path=/ (ADR 012, V5). Better Auth keeps these names only when they
 * are set in `advanced.cookies`.
 */
export const COOKIE_NAMES = {
  session_token: { name: '__Host-session' },
  two_factor: { name: '__Host-two-factor' },
  'better-auth-passkey': { name: '__Host-passkey-challenge' },
} as const

/** Our own cookie, set by the panel, not by Better Auth. */
export const DEVICE_COOKIE = '__Host-device'

/** Better Auth's session cookie, cleared by the panel when the account is deleted. */
export const SESSION_COOKIE = COOKIE_NAMES.session_token.name
