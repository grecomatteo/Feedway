// Why a destination did not come out (§9.5; plan 07, Task 2). Codes, not texts: the panel's
// text is `publishing.errors.<code>` (it.json), and a test fails when a code has no text.

export const PUBLISH_ERROR_CODES = [
  // from Meta, the table of §9.5
  'token_invalid',
  'permission_missing',
  'media_processing',
  'media_rejected',
  'duplicate',
  'rate_limited',
  'quota_exhausted',
  'account_restricted',
  'meta_error',
  // from Feedway
  'too_late',
  'uncertain_not_found',
  'file_wont_publish',
  'author_lost_permission',
  'organization_suspended',
] as const
export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number]

// The table of §9.5; the list grows with the real tests (Task 10).
const BY_META_CODE: ReadonlyMap<number, PublishErrorCode> = new Map([
  [190, 'token_invalid'],
  [200, 'permission_missing'],
  [10, 'permission_missing'],
  [9007, 'media_processing'],
  [9004, 'media_rejected'],
  [2207026, 'media_rejected'],
  [506, 'duplicate'],
  [4, 'rate_limited'],
  [17, 'rate_limited'],
  [32, 'rate_limited'],
  [613, 'rate_limited'],
  // also rate limits for the Meta client (`classifyMetaError`, docs/platforms/meta.md)
  [341, 'rate_limited'],
  [80001, 'rate_limited'],
  [80002, 'rate_limited'],
  // Instagram Error Codes: codes and subcodes of the content publishing API (not verified)
  [2207027, 'media_processing'],
  [2207052, 'media_rejected'],
  [352, 'media_rejected'],
  [36000, 'media_rejected'],
  [36001, 'media_rejected'],
  [36003, 'media_rejected'],
  [9, 'quota_exhausted'],
  [2207042, 'quota_exhausted'],
  [25, 'account_restricted'],
  [2207050, 'account_restricted'],
])

/** The Feedway code of a Meta error; Instagram's subcodes (`error_subcode`) count first. */
export function publishErrorCodeOfMeta(
  metaCode: number | null,
  subcode: number | null = null,
): PublishErrorCode {
  return (
    (subcode === null ? undefined : BY_META_CODE.get(subcode)) ??
    (metaCode === null ? undefined : BY_META_CODE.get(metaCode)) ??
    'meta_error'
  )
}

/** The translation key of the panel's text. */
export function publishErrorMessage(
  code: PublishErrorCode,
): `publishing.errors.${PublishErrorCode}` {
  return `publishing.errors.${code}`
}
