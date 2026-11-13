import type { Platform } from './accounts.js'

/** The pictures Meta gives are small: anything larger is not a profile picture. */
export const ACCOUNT_AVATAR_MAX_BYTES = 5 * 1024 * 1024
/** A download that takes longer is dropped: the previous picture stays. */
export const ACCOUNT_AVATAR_TIMEOUT_MS = 10_000
/** Meta's Page pictures can be 50 px: only a degenerate image is refused. */
export const ACCOUNT_AVATAR_MIN_SIDE = 16

/**
 * The 256 px picture of a social account as Feedway keeps it (plan 04 Task 4), in the panel and
 * never on the public host, with the hash of the file so a new picture is never served from a
 * cache. null: none stored yet (the panel shows the initials).
 */
export function accountAvatarUrl(
  slug: string,
  accountId: string,
  avatarKey: string | null,
): string | null {
  if (avatarKey === null) return null
  const hash = avatarKey.split('/').at(-1) ?? ''
  return `/api/v1/orgs/${encodeURIComponent(slug)}/accounts/${encodeURIComponent(accountId)}/avatar/256?v=${encodeURIComponent(hash)}`
}

/** The account whose picture shows a profile (§3): its Instagram's, else its Page's. */
export function profilePhotoAccount<A extends { platform: Platform; avatarKey: string | null }>(
  accounts: readonly A[],
): A | null {
  return (
    accounts.find((a) => a.platform === 'instagram' && a.avatarKey !== null) ??
    accounts.find((a) => a.avatarKey !== null) ??
    null
  )
}
