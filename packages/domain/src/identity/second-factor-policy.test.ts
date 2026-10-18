import { expect, test } from 'vitest'
import {
  canRemoveSecondFactor,
  effectivePolicy,
  requiresSecondFactor,
  sessionSatisfiesSecondFactor,
} from './second-factor-policy.js'

test('organization can only make 2FA stricter', () => {
  expect(effectivePolicy('admins', 'all')).toBe('all')
  expect(effectivePolicy('all', 'admins')).toBe('all')
  expect(effectivePolicy('admins', null)).toBe('admins')
  expect(effectivePolicy('admins', 'admins')).toBe('admins')
})
test('second factor requirement', () => {
  expect(requiresSecondFactor({ platformRole: 'admin', orgRoles: [] })).toBe(true)
  expect(requiresSecondFactor({ platformRole: null, orgRoles: [] })).toBe(false)
  expect(
    requiresSecondFactor({ platformRole: null, orgRoles: [{ role: 'member', policy: 'admins' }] }),
  ).toBe(false)
  expect(
    requiresSecondFactor({
      platformRole: null,
      orgRoles: [
        { role: 'member', policy: 'admins' },
        { role: 'member', policy: 'all' },
      ],
    }),
  ).toBe(true)
  expect(
    requiresSecondFactor({ platformRole: null, orgRoles: [{ role: 'admin', policy: 'admins' }] }),
  ).toBe(true)
  expect(
    requiresSecondFactor({ platformRole: null, orgRoles: [{ role: 'owner', policy: 'admins' }] }),
  ).toBe(true)
})
test('passkey and totp sessions satisfy the second factor, password alone does not', () => {
  expect(sessionSatisfiesSecondFactor('passkey')).toBe(true)
  expect(sessionSatisfiesSecondFactor('password_totp')).toBe(true)
  expect(sessionSatisfiesSecondFactor('password_backup_code')).toBe(true)
  expect(sessionSatisfiesSecondFactor('password')).toBe(false)
  expect(sessionSatisfiesSecondFactor('activation')).toBe(false)
})
test('last required second factor cannot be removed', () => {
  expect(
    canRemoveSecondFactor({ required: true, totpEnabled: true, passkeys: 0, removing: 'totp' }),
  ).toBe(false)
  expect(
    canRemoveSecondFactor({ required: true, totpEnabled: true, passkeys: 1, removing: 'totp' }),
  ).toBe(true)
  expect(
    canRemoveSecondFactor({ required: true, totpEnabled: false, passkeys: 1, removing: 'passkey' }),
  ).toBe(false)
  expect(
    canRemoveSecondFactor({ required: true, totpEnabled: false, passkeys: 2, removing: 'passkey' }),
  ).toBe(true)
  expect(
    canRemoveSecondFactor({ required: true, totpEnabled: true, passkeys: 1, removing: 'passkey' }),
  ).toBe(true)
  expect(
    canRemoveSecondFactor({
      required: false,
      totpEnabled: false,
      passkeys: 1,
      removing: 'passkey',
    }),
  ).toBe(true)
})

test('platform policy "all" covers users without memberships', () => {
  expect(requiresSecondFactor({ platformRole: null, orgRoles: [], platformPolicy: 'all' })).toBe(
    true,
  )
  expect(requiresSecondFactor({ platformRole: null, orgRoles: [], platformPolicy: 'admins' })).toBe(
    false,
  )
})

test('impossible passkey count does not cancel the TOTP', () => {
  expect(
    canRemoveSecondFactor({ required: true, totpEnabled: true, passkeys: 0, removing: 'passkey' }),
  ).toBe(true)
})
