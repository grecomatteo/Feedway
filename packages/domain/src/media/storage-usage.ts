import { checkLimit, type OrganizationLimits } from '../organizations/limits.js'
import { VARIANT_RECIPE, type VariantPurpose } from './media.js'

// Where a media file is stored, and whether more bytes fit (spec §11.1 point 6, plan 04 M5).

/** Every file of a media: the original and its variants (plan 04, storage keys). */
export const mediaPrefix = (organizationId: string, mediaId: string) =>
  `org/${organizationId}/media/${mediaId}/`

/**
 * The key of a copy. `recipe` is the fingerprint of what the copy applies (a crop, a frame…,
 * plan 07 P4), `''` for the copies of one per purpose: two recipes never share a key.
 */
export function mediaVariantKey(
  organizationId: string,
  mediaId: string,
  purpose: VariantPurpose | 'original',
  extension: string,
  recipe = '',
): string {
  if (!VARIANT_RECIPE.test(recipe)) throw new Error(`not a recipe: ${recipe}`)
  const name = recipe === '' ? purpose : `${purpose}-${recipe}`
  return `${mediaPrefix(organizationId, mediaId)}${name}.${extension}`
}

/** Bytes kept: originals, copies and thumbnails of files not yet removed. */
export interface StorageUsed {
  organization: number
  workspace: number
}

export interface StorageLimits {
  limits: OrganizationLimits
  /** MEDIA_WORKSPACE_MAX_BYTES; null: no limit per workspace */
  workspaceMaxBytes: number | null
}

export type StorageCheck =
  { ok: true } | { ok: false; scope: 'organization' | 'workspace'; limit: number }

/** Whether `adding` more bytes fit: the agency's `storage_bytes` first, then the workspace's. */
export function checkStorage(
  limits: StorageLimits,
  used: StorageUsed,
  adding: number,
): StorageCheck {
  const agency = checkLimit(limits.limits, 'storage_bytes', used.organization, adding)
  if (!agency.ok) return { ok: false, scope: 'organization', limit: agency.limit }
  const max = limits.workspaceMaxBytes
  if (max !== null && used.workspace + adding > max)
    return { ok: false, scope: 'workspace', limit: max }
  return { ok: true }
}
