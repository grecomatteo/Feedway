import type { OrgRole } from '../authz/index.js'

export type TwoFactorPolicy = 'admins' | 'all'
export type AuthMethod =
  'activation' | 'password' | 'password_totp' | 'password_backup_code' | 'passkey'

/** An organization can make the platform policy stricter, never looser. */
export function effectivePolicy(
  platform: TwoFactorPolicy,
  org: TwoFactorPolicy | null,
): TwoFactorPolicy {
  return platform === 'all' || org === 'all' ? 'all' : 'admins'
}

/**
 * `platformPolicy` covers users with no membership left: with REQUIRE_2FA=all
 * the spec (§15.1) requires a second factor from everyone.
 */
export function requiresSecondFactor(user: {
  platformRole: 'admin' | null
  orgRoles: { role: OrgRole; policy: TwoFactorPolicy }[]
  platformPolicy?: TwoFactorPolicy
}): boolean {
  if (user.platformRole === 'admin' || user.platformPolicy === 'all') return true
  return user.orgRoles.some(({ role, policy }) => policy === 'all' || role !== 'member')
}

export function sessionSatisfiesSecondFactor(method: AuthMethod): boolean {
  return method === 'password_totp' || method === 'password_backup_code' || method === 'passkey'
}

/** When a second factor is required, the last one left (TOTP or passkey) stays. */
export function canRemoveSecondFactor(input: {
  required: boolean
  totpEnabled: boolean
  passkeys: number
  removing: 'totp' | 'passkey'
}): boolean {
  if (!input.required) return true
  const totpLeft = input.totpEnabled && input.removing !== 'totp' ? 1 : 0
  const passkeysLeft =
    input.removing === 'passkey' ? Math.max(0, input.passkeys - 1) : input.passkeys
  return totpLeft + passkeysLeft > 0
}
