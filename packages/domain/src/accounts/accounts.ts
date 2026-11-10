// The accounts module knows platforms and connection kinds only as closed lists (ADR 019): a new
// platform widens them, with a migration for the checks in the database.

export const PLATFORMS = ['instagram', 'facebook'] as const
export type Platform = (typeof PLATFORMS)[number]

/** How Feedway reaches an account (spec §8.0, ADR 020). */
export const CONNECTION_KINDS = ['meta_system_user', 'meta_business_login'] as const
export type ConnectionKind = (typeof CONNECTION_KINDS)[number]

/**
 * `pending`: a new connection with no account imported yet (plan 03, choice 6). `expired`: the
 * token stopped working; `revoked`: the client took the access away.
 */
export const CONNECTION_STATUSES = ['pending', 'active', 'expired', 'revoked'] as const
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]

/** Last health check of an account (§8.4); `error` is red. */
export const ACCOUNT_HEALTHS = ['ok', 'warning', 'error'] as const
export type AccountHealth = (typeof ACCOUNT_HEALTHS)[number]

export interface ProfileAccount {
  id: string
  platform: Platform
  /** The key Meta itself gives to the pair (§3): a Page's own id, or the Page of an Instagram. */
  pageId: string | null
  active: boolean
}

export interface Profile<A extends ProfileAccount> {
  /** Stable for the same accounts: `page:<pageId>`, or `account:<id>` for an unpaired one. */
  key: string
  accounts: A[]
}

const PLATFORM_ORDER: readonly Platform[] = PLATFORMS

/**
 * The profiles of one workspace (§3), from the accounts assigned to it and only those: an account
 * outside the list (another workspace, or not assigned) is never named, so a pair with one side
 * missing or inactive is a profile of one. Order: first appearance in the list; Instagram first
 * inside a profile.
 */
export function formProfiles<A extends ProfileAccount>(
  accountsInWorkspace: readonly A[],
): Profile<A>[] {
  const profiles = new Map<string, A[]>()
  for (const account of accountsInWorkspace) {
    if (!account.active) continue
    const key = account.pageId === null ? `account:${account.id}` : `page:${account.pageId}`
    const group = profiles.get(key)
    if (group) group.push(account)
    else profiles.set(key, [account])
  }
  return [...profiles].map(([key, accounts]) => ({
    key,
    accounts: accounts.sort(
      (a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform),
    ),
  }))
}

/**
 * Can be chosen as a destination of a post: active, checked at least once and not red (§8.4).
 * `health` null: never checked yet.
 */
export function isSelectable(account: { active: boolean; health: AccountHealth | null }): boolean {
  return account.active && account.health !== null && account.health !== 'error'
}

const REFRESH_AHEAD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The token is renewed from 7 days before it expires. A token with no expiry (system user) is
 * never renewed, and neither is a connection that no longer works: it needs a new login.
 */
export function connectionNeedsRefresh(
  connection: { status: ConnectionStatus; expiresAt: Date | null },
  now: Date,
): boolean {
  if (connection.expiresAt === null) return false
  if (connection.status !== 'active' && connection.status !== 'pending') return false
  return connection.expiresAt.getTime() - now.getTime() <= REFRESH_AHEAD_MS
}

const works = (status: ConnectionStatus) => status === 'active' || status === 'pending'

/**
 * One account, one connection (plan 03, choice 2): a connection that also sees an account takes
 * it only when the owner no longer works ("reconnect"), and only if the newcomer works itself.
 * The owner always keeps its own.
 */
export function canTakeOver(
  owner: { id: string; status: ConnectionStatus },
  newcomer: { id: string; status: ConnectionStatus },
): boolean {
  if (owner.id === newcomer.id) return true
  return works(newcomer.status) && !works(owner.status)
}
