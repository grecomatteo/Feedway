export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  /** A link from an email or an invite that is unknown, used or expired (410). */
  | 'LINK_INVALID'

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
