// What a session that still owes a second factor may reach. Everything else answers 403
// SECOND_FACTOR_REQUIRED (the request middleware of Task 19 and the Better Auth hook of Task 14).

type Route = `${'GET' | 'POST'} ${string}`

/** Always open: leaving, and reading the session state itself. */
const ALWAYS: ReadonlySet<Route> = new Set(['POST /api/auth/sign-out', 'GET /api/auth/get-session'])

/** Only before any factor exists: the first TOTP or the first passkey. */
const FIRST_SETUP: readonly (Route | RegExp)[] = [
  'GET /api/v1/me',
  /^POST \/api\/v1\/links\/[^/]+\/complete$/,
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
  if (ALWAYS.has(route as Route)) return true
  if (factors.totpEnabled || factors.passkeys > 0) return false
  return FIRST_SETUP.some((r) => (typeof r === 'string' ? r === route : r.test(route)))
}
