export type LinkKind = 'bootstrap' | 'invite' | 'organization_owner'

export const LINK_TTL_MS: Readonly<Record<LinkKind, number>> = {
  bootstrap: 3600_000,
  invite: 72 * 3600_000,
  organization_owner: 3600_000,
}
