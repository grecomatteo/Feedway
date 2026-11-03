import type { PanelCookie } from '@app/application'
import { SESSION_IDLE_MS } from '@app/domain'
import { DEVICE_COOKIE_MAX_AGE_SECONDS } from './device-id.js'

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

/** The theme chosen in the panel (`@nuxtjs/color-mode`, `storageKey` in nuxt.config.ts). */
export const THEME_COOKIE = 'theme'

/** How long Better Auth keeps the cookie between password and second factor (set in its config). */
export const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 600
/** Fixed by @better-auth/passkey (MAX_AGE_IN_SECONDS) in the pinned version. */
const PASSKEY_CHALLENGE_MAX_AGE_SECONDS = 300
/** The color-mode default, written out in nuxt.config.ts (`cookieAttrs`). */
export const THEME_COOKIE_MAX_AGE_SECONDS = 365 * 86_400

/**
 * Every cookie the panel sets, for the privacy notice (spec §15.7): only technical cookies.
 * The session cookie lasts as long as the session may stay unused; using it renews it.
 */
export const PANEL_COOKIES: readonly PanelCookie[] = [
  {
    name: COOKIE_NAMES.session_token.name,
    purpose: 'session',
    maxAgeSeconds: SESSION_IDLE_MS / 1000,
  },
  {
    name: COOKIE_NAMES.two_factor.name,
    purpose: 'second_factor',
    maxAgeSeconds: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
  },
  {
    name: COOKIE_NAMES['better-auth-passkey'].name,
    purpose: 'passkey',
    maxAgeSeconds: PASSKEY_CHALLENGE_MAX_AGE_SECONDS,
  },
  { name: DEVICE_COOKIE, purpose: 'device', maxAgeSeconds: DEVICE_COOKIE_MAX_AGE_SECONDS },
  { name: THEME_COOKIE, purpose: 'theme', maxAgeSeconds: THEME_COOKIE_MAX_AGE_SECONDS },
]
