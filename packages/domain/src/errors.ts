export const DOMAIN_ERROR_CODES = [
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'VALIDATION',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  /** A link from an email or an invite that is unknown, used or expired (410). */
  'LINK_INVALID',
  /** A sensitive action needs the password or a passkey again (403). */
  'REAUTH_REQUIRED',
  /** The password given to confirm the identity is wrong or missing; the session stays (403). */
  'REAUTH_FAILED',
  /** The session must add or use a second factor first (403). */
  'SECOND_FACTOR_REQUIRED',
  /** The agency is suspended: its members cannot work in it (403). */
  'ORGANIZATION_SUSPENDED',
  /** A limit of the agency is reached (409). */
  'LIMIT_REACHED',
  /** The action sends an email and the platform has no email configured (409). */
  'MAIL_NOT_CONFIGURED',
  /** The mail server did not take a message the action depends on; nothing was kept (502). */
  'MAIL_SEND_FAILED',
] as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}
