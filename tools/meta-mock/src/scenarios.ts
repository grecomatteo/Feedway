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
   * 190/463 (or `subcode`: 458, the user removed the app; 460, a system user token revoked in
   * the Business Manager, recorded on 2026-11-12) on every call with the token (all tokens when
   * omitted), with HTTP 401; `debug_token` says invalid, with the same subcode.
   */
  token_expired: { token?: string; subcode?: 458 | 460 | 463 | 467 }
  /** The permission drops out of `debug_token` and `me/permissions`; calls on `path` answer `code`. */
  permission_missing: {
    path?: string | RegExp
    permission?: string
    token?: string
    code?: 10 | 200
  }
  /**
   * The permissions join `debug_token` and `me/permissions` (the token, or all): by default the
   * two of the cover of a Facebook reel, `pages_manage_engagement` and `pages_read_user_content`.
   */
  permissions_added: { permissions?: string[]; token?: string }
  /** The node disappears from every list and its own id answers 100/33. */
  asset_removed: { id: string }
  /** `content_publishing_limit` reports the whole quota used, and `media_publish` answers 9/2207042. */
  quota_exhausted: { igUserId?: string }
  /**
   * Containers created from now (videos only, or `all`) answer `IN_PROGRESS` for `reads` (3)
   * status reads, then `FINISHED`.
   */
  container_in_progress: { reads?: number; all?: boolean; times?: number }
  /** Containers created from now end in `ERROR` (status 2207026, a video Meta cannot read). */
  container_error: { times?: number }
  /** Every container read or published from now is `EXPIRED`: `media_publish` answers -2/2207020. */
  container_expired: { times?: number }
  /**
   * `media_publish` (on Facebook: every call that publishes) publishes, then answers after
   * `delayMs` (15 s, beyond the client timeout): the uncertain outcome of §9.5. Once by default.
   */
  publish_timeout_but_created: { delayMs?: number; times?: number }
  /**
   * The files are not downloaded: on Instagram an image answers 9004/2207052, a video ends in
   * `ERROR`; on Facebook a photo answers 324, a video 389.
   */
  media_download_failed: { times?: number }
  /**
   * Instagram: a container made with `collaborators` (any, or one that names `username`)
   * answers 100 with no subcode, as for a username that does not exist or an account that
   * takes no collaboration tags (D-125). Meta's real answer is not verified: written from the
   * documentation and the community, which do not say it.
   */
  collaborator_rejected: { username?: string; times?: number }
  /**
   * Instagram: `GET /{ig-media-id}/collaborators` says the invitation (of `username`, or of
   * everyone) `Accepted` or `Declined` from now; `Pending` otherwise.
   */
  collaborator_answered: { username?: string; status: 'Accepted' | 'Declined' }
  /** Facebook: the next call that publishes answers 506, a duplicate post. */
  duplicate_post: { times?: number }
  /** Facebook: videos created from now stay `processing` for `reads` (3) status reads. */
  video_processing: { reads?: number; times?: number }
  /** Facebook: videos created from now end in `error` once uploaded. */
  video_error: { times?: number }
  /** Facebook: `GET /{page}?fields=access_token` answers without the token (the Page, or all). */
  page_token_missing: { pageId?: string }
  /** A rate limit error, with the usage headers at 100% and `minutesToRegain` (5) in the business one. */
  rate_limited: Match & { code?: 4 | 17 | 32 | 613 | 80001 | 80002; minutesToRegain?: number }
  /**
   * Every answer from now carries these usage percentages (call count, CPU and time alike):
   * `app` in `X-App-Usage`, `business` in `X-Business-Use-Case-Usage` with `minutesToRegain`
   * (0). For the slowing down of the publishing (§8.6).
   */
  usage_high: { app?: number; business?: number; minutesToRegain?: number }
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
  /**
   * The node (a Page or an Instagram account) gets another picture, at another address:
   * `forno-nuova` by default, among those in `fixtures/pictures/`.
   */
  picture_changed: { id: string; picture?: string }
  /**
   * A post out on Instagram gets its picture (`media_url`, and a video's `thumbnail_url`) at
   * `url`: another host, for the grid's allowed hosts. `{{mock}}` is the mock's own address.
   */
  media_url_changed: { id: string; url: string }
  /** The pictures (or only `picture`) answer 200 with bytes that are no image. */
  picture_not_image: { picture?: string }
  /** The pictures (or only `picture`) answer 302 towards `to`. */
  picture_redirect: { to: string; picture?: string }
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
