import type { MetaUsage } from '@app/domain/platforms/meta'

export type MetaErrorKind = 'transient' | 'permanent' | 'uncertain'

/** What went wrong, for the use cases (the connection state is theirs to choose, Task 10). */
export type MetaErrorReason =
  | 'token_invalid'
  | 'token_revoked'
  | 'checkpoint'
  | 'page_role_missing'
  | 'permission_missing'
  | 'rate_limited'
  | 'blocked'
  | 'not_found_or_forbidden'
  | 'meta_unavailable'
  | 'timeout'
  | 'invalid_response'
  | 'rejected'

// Fixed Feedway texts: Meta's own message never leaves the client (plan 03, Task 3).
const MESSAGES: Record<MetaErrorReason, string> = {
  token_invalid: 'Meta no longer accepts the access token',
  token_revoked: 'The Meta user removed the authorization',
  checkpoint: 'The Meta account must sign in on facebook.com',
  page_role_missing: 'The Meta user has no role on the page',
  permission_missing: 'A required Meta permission is missing',
  rate_limited: 'Meta rate limit reached',
  blocked: 'Meta temporarily blocked the request',
  not_found_or_forbidden: 'Meta object not found or not accessible',
  meta_unavailable: 'Meta is temporarily unavailable',
  timeout: 'Meta did not answer in time',
  invalid_response: 'Meta answered in an unexpected format',
  rejected: 'Meta rejected the request',
}

export class MetaError extends Error {
  readonly kind: MetaErrorKind
  readonly reason: MetaErrorReason
  readonly status: number | null
  readonly metaCode: number | null
  readonly subcode: number | null
  readonly fbtraceId: string | null
  readonly retryAfterSeconds: number | null
  readonly usage: MetaUsage | null

  constructor(fields: {
    kind: MetaErrorKind
    reason: MetaErrorReason
    status?: number | null
    metaCode?: number | null
    subcode?: number | null
    fbtraceId?: string | null
    retryAfterSeconds?: number | null
    usage?: MetaUsage | null
  }) {
    super(MESSAGES[fields.reason])
    this.name = 'MetaError'
    this.kind = fields.kind
    this.reason = fields.reason
    this.status = fields.status ?? null
    this.metaCode = fields.metaCode ?? null
    this.subcode = fields.subcode ?? null
    this.fbtraceId = fields.fbtraceId ?? null
    this.retryAfterSeconds = fields.retryAfterSeconds ?? null
    this.usage = fields.usage ?? null
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002])

/**
 * Class and reason from `code` and `error_subcode` only, never from the text: the table in
 * docs/platforms/meta.md §Errori.
 */
export function classifyMetaError(
  code: number,
  subcode: number | null,
): { kind: MetaErrorKind; reason: MetaErrorReason } {
  if (code === 190) {
    if (subcode === 458) return { kind: 'permanent', reason: 'token_revoked' }
    if (subcode === 459 || subcode === 464) return { kind: 'permanent', reason: 'checkpoint' }
    if (subcode === 492) return { kind: 'permanent', reason: 'page_role_missing' }
    return { kind: 'permanent', reason: 'token_invalid' }
  }
  if (code === 3 || code === 10 || (code >= 200 && code <= 299))
    return { kind: 'permanent', reason: 'permission_missing' }
  // not in Meta's table: from the Postiz/OpenPost research, not verified
  if (code === 100 && subcode === 33) return { kind: 'uncertain', reason: 'not_found_or_forbidden' }
  if (RATE_LIMIT_CODES.has(code)) return { kind: 'transient', reason: 'rate_limited' }
  if (code === 368) return { kind: 'transient', reason: 'blocked' }
  if (code === 1 || code === 2) return { kind: 'transient', reason: 'meta_unavailable' }
  return { kind: 'permanent', reason: 'rejected' }
}
