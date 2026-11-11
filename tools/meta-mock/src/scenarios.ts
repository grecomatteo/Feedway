/** Which requests a fault applies to: a path without the version (`/me/accounts`), and how many times. */
export interface Match {
  path?: string | RegExp
  times?: number
}

type None = Record<string, never>

/**
 * The scenarios of plan 03, Task 2. Error payloads are written by hand from Meta's error
 * documentation (docs/platforms/meta.md) and are not verified on the real Graph API.
 */
export interface ScenarioOptions {
  /** Back to the initial data, with no scenario active. */
  default: None
  /**
   * 190/463 (or `subcode`: 458, the user removed the app) on every call with the token (all
   * tokens when omitted); `debug_token` says invalid, with the same subcode.
   */
  token_expired: { token?: string; subcode?: 458 | 460 | 463 | 467 }
  /** The permission drops out of `debug_token` and `me/permissions`; calls on `path` answer `code`. */
  permission_missing: {
    path?: string | RegExp
    permission?: string
    token?: string
    code?: 10 | 200
  }
  /** The node disappears from every list and its own id answers 100/33. */
  asset_removed: { id: string }
  /** `content_publishing_limit` reports the whole quota used. */
  quota_exhausted: { igUserId?: string }
  /** A rate limit error, with the usage headers at 100% and `minutesToRegain` (5) in the business one. */
  rate_limited: Match & { code?: 4 | 17 | 32 | 613 | 80001 | 80002; minutesToRegain?: number }
  /** A temporary error (code 2 by default) as JSON. */
  transient_error: Match & { code?: 1 | 2; status?: number; retryAfter?: number }
  /** Any Graph API error, for the rows of the error table. */
  error: Match & {
    code: number
    subcode?: number
    status?: number
    type?: string
    retryAfter?: number
  }
  /** The answer arrives after `delayMs` (15 s by default, beyond the client timeout). */
  timeout: Match & { delayMs?: number }
  /** A 200 whose body is not valid JSON (or `body`). */
  malformed: Match & { body?: string }
  /** An HTML error page, as when Meta's front end fails. */
  html_5xx: Match & { status?: number; retryAfter?: number }
  /** The login dialog comes back with `error=access_denied`. */
  access_denied: None
  /** The login dialog gives a token whose portfolio has only a personal Instagram profile, so no account. */
  personal_ig_profile: None
  /** `me/accounts` lists the page without `access_token`: the user has no role on it. */
  page_without_token: { pageId?: string }
}

export type ScenarioName = keyof ScenarioOptions

export type ScenarioArgs<N extends ScenarioName> = None extends ScenarioOptions[N]
  ? [opts?: ScenarioOptions[N]]
  : [opts: ScenarioOptions[N]]

export type ActiveScenario = {
  [N in ScenarioName]: { name: N; opts: ScenarioOptions[N]; remaining: number }
}[ScenarioName]

export function matches(match: Match, path: string): boolean {
  if (match.path === undefined) return true
  return typeof match.path === 'string' ? match.path === path : match.path.test(path)
}
