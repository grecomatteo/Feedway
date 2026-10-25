import { expect, test } from 'vitest'
import { authMethodForPath, isSecondFactorGatedAuthPath } from './auth-hooks.js'

test('account paths are gated by the request middleware, sign-in and code paths are not', () => {
  for (const path of [
    '/two-factor/enable',
    '/change-password',
    '/passkey/generate-register-options?x=1',
    '/change-email/',
  ])
    expect(isSecondFactorGatedAuthPath(path), path).toBe(true)
  for (const path of [
    '/sign-in/email',
    '/sign-out',
    '/get-session',
    '/two-factor/verify-totp',
    '/two-factor/verify-backup-code',
    '/passkey/verify-authentication',
    '/reset-password',
  ])
    expect(isSecondFactorGatedAuthPath(path), path).toBe(false)
})

test('only the sign-in paths give a method, never an inherited property', () => {
  expect(authMethodForPath('/sign-in/email')).toBe('password')
  for (const path of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '/sign-out'])
    expect(authMethodForPath(path), path).toBeUndefined()
})
