/** As the profile photo: the web processes it with sharp, the worker never sees it. */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024
/** A logo is often a wide word mark: only its shortest side has a floor. */
export const LOGO_MIN_SIDE = 16

/**
 * The 256 px logo of the agency, in the panel (never on the public host), with the hash of the
 * file so a new logo is never served from a cache. The slug never changes.
 */
export function logoUrl(slug: string, logoKey: string | null): string | null {
  if (logoKey === null) return null
  const hash = logoKey.split('/').at(-1) ?? ''
  return `/api/v1/orgs/${encodeURIComponent(slug)}/logo/256?v=${encodeURIComponent(hash)}`
}
