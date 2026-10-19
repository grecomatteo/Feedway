import { expect, test } from 'vitest'
import { allowedWhileSecondFactorRequired } from './second-factor-gate.js'

const firstSetup = { totpEnabled: false, passkeys: 0 }
const register = '/api/auth/passkey/generate-register-options'
const registerMethod = 'GET'

test('first-time setup may enrol a factor; a stolen password alone cannot add one', () => {
  expect(allowedWhileSecondFactorRequired('POST', '/api/auth/two-factor/enable', firstSetup)).toBe(
    true,
  )
  expect(allowedWhileSecondFactorRequired(registerMethod, register, firstSetup)).toBe(true)
  for (const f of [
    { totpEnabled: false, passkeys: 1 },
    { totpEnabled: true, passkeys: 0 },
  ]) {
    expect(allowedWhileSecondFactorRequired('POST', '/api/auth/two-factor/enable', f)).toBe(false)
    expect(allowedWhileSecondFactorRequired(registerMethod, register, f)).toBe(false)
    expect(allowedWhileSecondFactorRequired('GET', '/api/v1/me', f)).toBe(false)
    expect(allowedWhileSecondFactorRequired('POST', '/api/auth/sign-out', f)).toBe(true)
    expect(allowedWhileSecondFactorRequired('GET', '/api/auth/get-session', f)).toBe(true)
  }
})

test('first-time setup reaches the profile, the activation completion and the TOTP steps only', () => {
  const allowed: [string, string][] = [
    ['GET', '/api/v1/me'],
    ['POST', '/api/v1/links/abc/complete'],
    ['POST', '/api/auth/two-factor/get-totp-uri'],
    ['POST', '/api/auth/two-factor/verify-totp'],
    ['POST', '/api/auth/passkey/verify-registration'],
  ]
  for (const [method, path] of allowed)
    expect(allowedWhileSecondFactorRequired(method, path, firstSetup)).toBe(true)
  const refused: [string, string][] = [
    ['GET', '/api/v1/organizations'],
    ['POST', '/api/v1/links/abc/activate'],
    ['GET', '/api/auth/sign-out'],
    ['POST', '/api/v1/me'],
    ['POST', '/api/v1/links/abc/complete/extra'],
    ['POST', '/api/auth/passkey/delete-passkey'],
  ]
  for (const [method, path] of refused)
    expect(allowedWhileSecondFactorRequired(method, path, firstSetup)).toBe(false)
})

test('the passkey of an activation closes its link, and a passkey sign-in stays reachable', () => {
  const withPasskey = { totpEnabled: false, passkeys: 1 }
  expect(
    allowedWhileSecondFactorRequired('POST', '/api/v1/links/Ab3_-x/complete', withPasskey),
  ).toBe(true)
  expect(
    allowedWhileSecondFactorRequired(
      'GET',
      '/api/auth/passkey/generate-authenticate-options',
      withPasskey,
    ),
  ).toBe(true)
  expect(
    allowedWhileSecondFactorRequired(
      'POST',
      '/api/auth/passkey/verify-authentication',
      withPasskey,
    ),
  ).toBe(true)
  for (const token of ['..', '.', 'a%2Fb', 'a.b'])
    expect(
      allowedWhileSecondFactorRequired('POST', `/api/v1/links/${token}/complete`, withPasskey),
    ).toBe(false)
})

test('the query string and a trailing slash do not change the answer', () => {
  expect(allowedWhileSecondFactorRequired('GET', '/api/auth/get-session?x=1', firstSetup)).toBe(
    true,
  )
  expect(allowedWhileSecondFactorRequired('POST', '/api/auth/sign-out/', firstSetup)).toBe(true)
  expect(allowedWhileSecondFactorRequired('post', '/api/auth/sign-out', firstSetup)).toBe(true)
})
