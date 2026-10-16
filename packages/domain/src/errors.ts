export type DomainErrorCode =
  'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'UNAUTHENTICATED' | 'RATE_LIMITED'

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
