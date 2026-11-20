// The media of a workspace (spec §11.1, §13; plan 04 Task 8).

export const MEDIA_KINDS = ['image', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/**
 * `deleted`: removed from the panel; its files go with the `media.delete_files` job, the row
 * stays so what was published keeps its history.
 */
export const MEDIA_STATUSES = ['uploading', 'processing', 'ready', 'failed', 'deleted'] as const
export type MediaStatus = (typeof MEDIA_STATUSES)[number]

/**
 * What a variant is for; `preview` is the panel's own copy and never public (§11.1 point 7),
 * nor is `master`, the photo kept up to 4096 px for the editor's crops (D-26).
 */
export const VARIANT_PURPOSES = [
  'ig_feed',
  'fb_photo',
  'reel',
  'story',
  'thumbnail',
  'share',
  'preview',
  'cover',
  'master',
] as const
export type VariantPurpose = (typeof VARIANT_PURPOSES)[number]

/**
 * A copy with a recipe (plan 07 P4) is made by the worker after the post is scheduled:
 * `pending` until then, `failed` with its reason when it cannot be made. The copies of one per
 * purpose are written when ready.
 */
export const VARIANT_STATUSES = ['pending', 'ready', 'failed'] as const
export type VariantStatus = (typeof VARIANT_STATUSES)[number]

/** The fingerprint of a copy's recipe, safe in a storage key; `''`: no recipe. */
export const VARIANT_RECIPE = /^[a-z0-9-]{0,64}$/

/** The length of a variant's `public_token` (plan 04, «Due host»). */
export const PUBLIC_TOKEN_LENGTH = 32

/** The progress of the worker's job on a file (§14.2, plan 04 M4). */
export interface MediaProgress {
  step: string
  /** 0–100 */
  percent: number
}
