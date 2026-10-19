// What a session that still owes a second factor may reach. Everything else answers 403
// SECOND_FACTOR_REQUIRED (the request middleware of Task 19 and the Better Auth hook of Task 14).

type Route = `${'GET' | 'POST'} ${string}`

/**
 * Always open: leaving, reading the session state, signing in again with a passkey (it opens a
 * new session that satisfies the rule, it adds no factor) and closing an activation link once
 * its passkey exists (it only marks the person's own link as used).
 */
const ALWAYS: readonly (Route | RegExp)[] = [
  'POST /api/auth/sign-out',
  'GET /api/auth/get-session',
  'GET /api/auth/passkey/generate-authenticate-options',
  'POST /api/auth/passkey/verify-authentication',
  /^POST \/api\/v1\/links\/[A-Za-z0-9_-]+\/complete$/,
]

/** Only before any factor exists: the first TOTP or the first passkey. */
const FIRST_SETUP: readonly (Route | RegExp)[] = [
  'GET /api/v1/me',
  'POST /api/auth/two-factor/enable',
  'POST /api/auth/two-factor/get-totp-uri',
  'POST /api/auth/two-factor/verify-totp',
  'GET /api/auth/passkey/generate-register-options',
  'POST /api/auth/passkey/verify-registration',
]

/**
 * A person who already has a factor must sign in with it: a stolen password alone may not add
 * a new one (spec §15.1).
 */
export function allowedWhileSecondFactorRequired(
  method: string,
  path: string,
  factors: { totpEnabled: boolean; passkeys: number },
): boolean {
  const bare = (path.split('?')[0] ?? '').replace(/\/+$/, '')
  const route = `${method.toUpperCase()} ${bare}`
  const matches = (r: Route | RegExp) => (typeof r === 'string' ? r === route : r.test(route))
  if (ALWAYS.some(matches)) return true
  if (factors.totpEnabled || factors.passkeys > 0) return false
  return FIRST_SETUP.some(matches)
}
