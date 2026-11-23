/**
 * The Meta permissions a connection needs (spec §8.1, docs/platforms/meta.md §Permessi): the
 * same six for the system user and the unified login. Whether `ads_management` or `ads_read`
 * are needed too is not verified (end of plan 03 Task 7).
 */
export const META_REQUIRED_PERMISSIONS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
] as const

export type MetaPermission = (typeof META_REQUIRED_PERMISSIONS)[number]

/**
 * The permissions that let Feedway set a reel's cover on a Page (`POST /{video-id}/thumbnails`,
 * D-120.9): optional, asked only for the cover. Without them the reel goes out all the same, with
 * the first frame as Facebook's own cover. From Meta's reference; not verified on real Meta.
 */
export const META_COVER_PERMISSIONS = [
  'pages_manage_engagement',
  'pages_read_user_content',
] as const

/** The connection may set the cover of a Facebook reel; `scopes` null: never read. */
export const hasCoverPermissions = (scopes: readonly string[] | null): boolean =>
  scopes !== null && META_COVER_PERMISSIONS.every((p) => scopes.includes(p))
