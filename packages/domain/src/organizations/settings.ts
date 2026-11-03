import { isPlainDisplayName } from '../identity/display-name.js'
import { normalizeEmail } from '../identity/email.js'
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

export const PRIVACY_CONTROLLER_MAX_LENGTH = 200
export const PRIVACY_EXTRA_TEXT_MAX_LENGTH = 2000
/** Control and direction characters; a new line is allowed in the extra text. */
const HIDDEN_IN_TEXT = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u

export type PrivacyField = 'privacy.controllerName' | 'privacy.contactEmail' | 'privacy.extraText'

/**
 * The controller data of an agency's privacy notice (spec §15.7), as stored: the controller's
 * name as plain text, a contact address, an optional extra text (plain text, shown as is).
 */
export function checkPrivacySettings(raw: {
  controllerName: string
  contactEmail: string
  extraText?: string
}): { ok: true; value: OrganizationPrivacySettings } | { ok: false; field: PrivacyField } {
  const controllerName = raw.controllerName.trim()
  const length = Array.from(controllerName).length
  if (length < 2 || length > PRIVACY_CONTROLLER_MAX_LENGTH || !isPlainDisplayName(controllerName))
    return { ok: false, field: 'privacy.controllerName' }
  const contactEmail = normalizeEmail(raw.contactEmail)
  if (contactEmail === null) return { ok: false, field: 'privacy.contactEmail' }
  const extraText = (raw.extraText ?? '').trim().replace(/\r\n?/g, '\n')
  if (
    Array.from(extraText).length > PRIVACY_EXTRA_TEXT_MAX_LENGTH ||
    HIDDEN_IN_TEXT.test(extraText.replace(/\n/g, ''))
  )
    return { ok: false, field: 'privacy.extraText' }
  return {
    ok: true,
    value: { controllerName, contactEmail, ...(extraText === '' ? {} : { extraText }) },
  }
}

/** What an agency stored, if it is complete; anything else counts as not filled in. */
export function storedPrivacySettings(
  settings: Record<string, unknown>,
): OrganizationPrivacySettings | null {
  const privacy = settings.privacy
  if (typeof privacy !== 'object' || privacy === null) return null
  const { controllerName, contactEmail, extraText } = privacy as Record<string, unknown>
  if (typeof controllerName !== 'string' || typeof contactEmail !== 'string') return null
  return {
    controllerName,
    contactEmail,
    ...(typeof extraText === 'string' ? { extraText } : {}),
  }
}
