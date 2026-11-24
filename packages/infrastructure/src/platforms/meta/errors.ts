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
  | 'media_not_ready'
  | 'media_rejected'
  | 'media_unreachable'
  | 'container_expired'
  | 'quota_exhausted'
  | 'account_restricted'
  | 'aborted'

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
  media_not_ready: 'Meta is still processing the media',
  media_rejected: 'Meta could not read the media',
  media_unreachable: 'Meta could not download the media',
  container_expired: 'The prepared media is no longer there: it must be created again',
  quota_exhausted: 'The account has no posts left in its publishing window',
  account_restricted: 'The account is restricted or must be confirmed on the platform',
  aborted: 'The call was stopped before Meta answered',
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

// Instagram's content publishing (Instagram Error Codes, docs/platforms/meta.md §Pubblicazione);
// Facebook's 324 (image missing or invalid), 382 (video too small)
const MEDIA_REJECTED_CODES = new Set([9004, 352, 36000, 36001, 36003, 324, 382])
// Meta could not fetch the file (Instagram's 2207052, Facebook's 389): the file may be right and
// Feedway's public host down for a moment, so it is tried again (D-131.2)
const MEDIA_UNREACHABLE = { subcodes: new Set([2207052]), codes: new Set([389]) }
// 2207032 and 2207053 (creation failed: make it again) are server errors, transient below
const CONTAINER_GONE_SUBCODES = new Set([2207020, 2207008])

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
  if (subcode !== null && CONTAINER_GONE_SUBCODES.has(subcode))
    return { kind: 'permanent', reason: 'container_expired' }
  if (code === 9007) return { kind: 'transient', reason: 'media_not_ready' }
  if (
    MEDIA_UNREACHABLE.codes.has(code) ||
    (subcode !== null && MEDIA_UNREACHABLE.subcodes.has(subcode))
  )
    return { kind: 'transient', reason: 'media_unreachable' }
  if (MEDIA_REJECTED_CODES.has(code)) return { kind: 'permanent', reason: 'media_rejected' }
  if (code === 9 && subcode === 2207042) return { kind: 'transient', reason: 'quota_exhausted' }
  if (code === 25) return { kind: 'permanent', reason: 'account_restricted' }
  // -1 and -2: Instagram's server error and download timeout, "try again"
  if (code === -1 || code === -2) return { kind: 'transient', reason: 'meta_unavailable' }
  if (code === 3 || code === 10 || (code >= 200 && code <= 299))
    return { kind: 'permanent', reason: 'permission_missing' }
  // not in Meta's table: from the Postiz/OpenPost research, not verified
  if (code === 100 && subcode === 33) return { kind: 'uncertain', reason: 'not_found_or_forbidden' }
  if (RATE_LIMIT_CODES.has(code)) return { kind: 'transient', reason: 'rate_limited' }
  if (code === 368) return { kind: 'transient', reason: 'blocked' }
  if (code === 1 || code === 2) return { kind: 'transient', reason: 'meta_unavailable' }
  return { kind: 'permanent', reason: 'rejected' }
}
