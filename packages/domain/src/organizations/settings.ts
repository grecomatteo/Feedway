import { isPlainDisplayName } from '../identity/display-name.js'
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
 * An agency or workspace name as stored: trimmed, 2 to 80 characters (the same bounds as
 * BOOTSTRAP_ORGANIZATION_NAME), plain text (`isPlainDisplayName`: no link, no control or
 * direction characters).
 */
export function checkOrganizationName(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: 'LENGTH' | 'INVALID' } {
  const name = raw.trim()
  const length = Array.from(name).length
  if (length < 2 || length > ORGANIZATION_NAME_MAX_LENGTH) return { ok: false, reason: 'LENGTH' }
  if (!isPlainDisplayName(name)) return { ok: false, reason: 'INVALID' }
  return { ok: true, value: name }
}

/** The same check; null when the name is not acceptable. */
export function organizationName(raw: string): string | null {
  const check = checkOrganizationName(raw)
  return check.ok ? check.value : null
}
