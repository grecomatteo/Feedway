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
