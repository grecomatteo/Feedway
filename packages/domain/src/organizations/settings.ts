import type { TwoFactorPolicy } from '../identity/second-factor-policy.js'

export interface OrganizationPrivacySettings {
  controllerName: string
  contactEmail: string
  extraText?: string
}

export interface OrganizationSettings {
  require2fa?: TwoFactorPolicy
  privacy?: OrganizationPrivacySettings
}

// Keys present in the patch replace the current value; `privacy` is replaced as a whole.
export function mergeSettings(
  current: OrganizationSettings,
  patch: OrganizationSettings,
): OrganizationSettings {
  return { ...current, ...patch }
}

export const ORGANIZATION_NAME_MAX_LENGTH = 80

/**
 * An agency name as stored: trimmed, 2 to 80 characters (the same bounds as
 * BOOTSTRAP_ORGANIZATION_NAME), no control characters. Null when it is not acceptable.
 */
export function organizationName(raw: string): string | null {
  const name = raw.trim()
  const length = Array.from(name).length
  if (length < 2 || length > ORGANIZATION_NAME_MAX_LENGTH) return null
  if (/\p{Cc}/u.test(name)) return null
  return name
}
