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
