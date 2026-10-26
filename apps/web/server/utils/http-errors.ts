// The one place where errors become HTTP answers (docs/convenzioni.md, "Errori"). Pure: no h3,
// so the mapping is unit-tested without a server.
import { DomainError, type DomainErrorCode } from '@app/domain'
import type { ApiErrorBody, ApiIssue } from '@app/contracts'
import { scrubSecrets } from '@app/infrastructure'
import type { z } from 'zod'
import it from '../../i18n/locales/it.json' with { type: 'json' }

/** Codes the HTTP layer adds to the domain ones: framework and request errors. */
type HttpCode =
  | 'SOLE_OWNER'
  | 'MAIL_NOT_CONFIGURED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'BAD_REQUEST'
  | 'REQUEST_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL'

export type ErrorCode = DomainErrorCode | HttpCode

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  REAUTH_REQUIRED: 403,
  REAUTH_FAILED: 403,
  SECOND_FACTOR_REQUIRED: 403,
  ORGANIZATION_SUSPENDED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LIMIT_REACHED: 409,
  SOLE_OWNER: 409,
  MAIL_NOT_CONFIGURED: 409,
  LINK_INVALID: 410,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  BAD_REQUEST: 400,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
}

export type ErrorReason = keyof typeof it.errorReasons

const MESSAGES: Readonly<Record<ErrorCode, string>> = it.errors
const REASONS: Readonly<Record<ErrorReason, string>> = it.errorReasons
const ISSUE_TEXT = it.errorDetails.issues

/** What a request that fails the CSRF check is told: nothing about which check failed. */
export const CSRF_MESSAGE = it.errorDetails.csrf

/** Seconds a client waits when a limit gives no figure. */
const DEFAULT_RETRY_AFTER_SECONDS = 60
const MAX_ISSUES = 20
const MAX_KEY_LENGTH = 64

/** An error the HTTP layer raises itself (CSRF, body, session, second factor…). */
export class HttpProblem extends Error {
  readonly code: ErrorCode
  readonly reason: ErrorReason | undefined
  readonly issues: ApiIssue[] | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(
    code: ErrorCode,
    opts: {
      message?: string
      reason?: ErrorReason
      issues?: ApiIssue[]
      retryAfterSeconds?: number
    } = {},
  ) {
    super(opts.message ?? (opts.reason ? REASONS[opts.reason] : MESSAGES[code]))
    this.name = 'HttpProblem'
    this.code = code
    this.reason = opts.reason
    this.issues = opts.issues
    this.retryAfterSeconds = opts.retryAfterSeconds
  }
}

export interface ErrorResponse {
  status: number
  headers: Record<string, string>
  body: ApiErrorBody
  /** True for a failure nobody expected: the caller logs it (with `failureForLog`). */
  unexpected: boolean
}

const STATUS_CODE: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  413: 'REQUEST_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
}

function frameworkStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}

function build(
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: { issues?: ApiIssue[] | undefined; reason?: string | undefined; retryAfter?: number },
): ErrorResponse {
  const headers: Record<string, string> = {}
  if (code === 'RATE_LIMITED')
    headers['retry-after'] = String(
      Math.max(1, Math.ceil(extra.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS)),
    )
  return {
    status: ERROR_STATUS[code],
    headers,
    unexpected: code === 'INTERNAL',
    body: {
      error: {
        code,
        message,
        requestId,
        ...(extra.issues && extra.issues.length > 0 && { issues: extra.issues }),
        ...(extra.reason !== undefined && { reason: extra.reason }),
      },
    },
  }
}

/**
 * The answer for any error. Domain errors keep their Italian message (written by the use
 * cases for the person in front of the screen) and only the details listed here: `field`
 * becomes an issue, `retryAfterSeconds` the Retry-After header. Everything else is a generic
 * 500 with the request id: no message, stack, SQL or parameter ever reaches the client.
 */
export function toErrorResponse(error: unknown, requestId: string): ErrorResponse {
  if (error instanceof HttpProblem)
    return build(error.code, error.message, requestId, {
      issues: error.issues,
      reason: error.reason,
      ...(error.retryAfterSeconds !== undefined && { retryAfter: error.retryAfterSeconds }),
    })

  if (error instanceof DomainError) {
    const message = error.message.trim() === '' ? MESSAGES[error.code] : error.message
    const field = error.details?.['field']
    const retry = error.details?.['retryAfterSeconds']
    return build(error.code, message, requestId, {
      ...(error.code === 'VALIDATION' &&
        typeof field === 'string' && { issues: [{ path: [field], message }] }),
      ...(typeof retry === 'number' && Number.isFinite(retry) && { retryAfter: retry }),
    })
  }

  const status = frameworkStatus(error)
  if (status !== undefined && status >= 400 && status < 500) {
    const code = STATUS_CODE[status] ?? 'BAD_REQUEST'
    return { ...build(code, MESSAGES[code], requestId, {}), status }
  }
  return build('INTERNAL', MESSAGES.INTERNAL, requestId, {})
}

function issueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.path.length === 0 ? ISSUE_TEXT.missingBody : ISSUE_TEXT.invalid
    case 'too_small':
      if (issue.origin === 'string' || issue.origin === 'array')
        return issue.minimum === 1 ? ISSUE_TEXT.required : ISSUE_TEXT.tooShort
      return ISSUE_TEXT.tooSmall
    case 'too_big':
      return issue.origin === 'string' || issue.origin === 'array'
        ? ISSUE_TEXT.tooLong
        : ISSUE_TEXT.tooBig
    default:
      return ISSUE_TEXT.invalid
  }
}

const pathOf = (path: readonly PropertyKey[]): (string | number)[] =>
  path.map((p) => (typeof p === 'number' ? p : String(p).slice(0, MAX_KEY_LENGTH)))

/**
 * Italian issues with their path. Built from the issue codes only: Zod's own messages and the
 * submitted values (a password, a token) never reach the answer.
 */
export function issuesFromZod(error: z.ZodError): ApiIssue[] {
  const issues = error.issues.flatMap((issue): ApiIssue[] =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({
          path: pathOf([...issue.path, key]),
          message: ISSUE_TEXT.unknownKey,
        }))
      : [{ path: pathOf(issue.path), message: issueMessage(issue) }],
  )
  return issues.slice(0, MAX_ISSUES)
}

const SAFE_CODE = /^[A-Z0-9_]{1,32}$/
const MAX_FRAMES = 15

/**
 * The stack after the message: a message with line breaks could carry lines that look like
 * frames. A stack that no longer holds the message (rewritten) gives no frames at all.
 */
function framesOf(error: Error): string[] {
  const stack = error.stack ?? ''
  if (error.message === '') return stack.split('\n').slice(1)
  const at = stack.indexOf(error.message)
  if (at === -1) return []
  return stack.slice(at + error.message.length).split('\n')
}

/**
 * What the log keeps of an unexpected failure: its type, its SQLSTATE or system code and the
 * stack frames, never the message. A failed query's message holds its parameters (emails,
 * token hashes, encrypted keys) and the logger cannot tell them apart (Task 16, CLI).
 */
export function failureForLog(error: unknown): { type: string; code?: string; frames: string[] } {
  let innermost: unknown = error
  let code: string | undefined
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 10; depth++) {
    const c = (e as { code?: unknown }).code
    if (code === undefined && typeof c === 'string' && SAFE_CODE.test(c)) code = c
    innermost = e
    e = e.cause
  }
  if (!(innermost instanceof Error)) return { type: typeof innermost, frames: [] }
  const frames = framesOf(innermost)
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim())
  return { type: innermost.name, ...(code !== undefined && { code }), frames }
}

/**
 * The log entry of an unexpected failure. The path is scrubbed here, not only by the logger,
 * because before startup finishes the entry goes to the console.
 */
export function failureEntry(
  request: { requestId: string; method: string; path: string },
  error: unknown,
) {
  return {
    requestId: request.requestId,
    method: request.method,
    path: scrubSecrets(request.path.split('?')[0] ?? ''),
    failure: failureForLog(error),
  }
}
