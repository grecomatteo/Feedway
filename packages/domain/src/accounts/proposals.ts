import { ORGANIZATION_NAME_MAX_LENGTH, organizationName } from '../organizations/settings.js'
import {
  formProfiles,
  PLATFORMS,
  type Platform,
  type Profile,
  type ProfileAccount,
} from './accounts.js'

// «Abbina ai clienti» (spec §14.7): what a connection found, proposed as one client per profile.
// The pairs come only from the platform's own link (`pageId`), never from names.

/** An account a connection sees, before or after its import. */
export interface FoundAccount {
  platform: Platform
  externalId: string
  name: string
  username: string | null
  /** The key of the profile (§3); null for an account with no pair. */
  pageId: string | null
  /** Already in at least one client. */
  inClient: boolean
}

/** Why the accounts of a proposal are together: the pair set on the platform, or one alone. */
export type ProposalReason = 'paired' | `${Platform}_only`

export interface ClientProposal<A extends FoundAccount = FoundAccount> {
  /** `page:<pageId>`, or `account:<platform>:<externalId>` for an account alone. */
  key: string
  accounts: A[]
  externalIds: string[]
  name: string
  together: ProposalReason
  /** One of its accounts is in a client already. */
  inClient: boolean
  /** Ticked at first: none of its accounts is in a client. */
  checked: boolean
}

const FALLBACK_NAME = 'Nuovo cliente'

/** The client's name from its profile: Instagram's name, then the Page's, then the handle. */
export function proposedName(
  accounts: readonly Pick<FoundAccount, 'platform' | 'name' | 'username'>[],
): string {
  const ordered = [...accounts].sort(byPlatform)
  const candidates = [...ordered.map((a) => a.name), ...ordered.map((a) => a.username ?? '')]
  for (const raw of candidates) {
    const cut = Array.from(raw.trim()).slice(0, ORGANIZATION_NAME_MAX_LENGTH).join('')
    const name = organizationName(cut)
    if (name !== null) return name
  }
  return FALLBACK_NAME
}

const byPlatform = (a: { platform: Platform }, b: { platform: Platform }) =>
  PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform)

/**
 * One proposal per profile, in the order the accounts came; Instagram first inside a profile. A
 * profile with any account already in a client is not ticked: it changes nothing unless the
 * person chooses it.
 */
export function proposeClients<A extends FoundAccount>(found: readonly A[]): ClientProposal<A>[] {
  const groups = new Map<string, A[]>()
  for (const account of found) {
    const key =
      account.pageId === null
        ? `account:${account.platform}:${account.externalId}`
        : `page:${account.pageId}`
    const group = groups.get(key)
    if (group) group.push(account)
    else groups.set(key, [account])
  }
  return [...groups].map(([key, group]) => {
    const accounts = group.sort(byPlatform)
    const inClient = accounts.some((a) => a.inClient)
    const [first] = accounts
    const together: ProposalReason =
      accounts.length > 1 || first === undefined ? 'paired' : `${first.platform}_only`
    return {
      key,
      accounts,
      externalIds: accounts.map((a) => a.externalId),
      name: proposedName(accounts),
      together,
      inClient,
      checked: !inClient,
    }
  })
}

/**
 * «Sistemali» (§14.7): the profiles of the active accounts that are in no client. An account
 * whose pair is in a client is a profile of its own here, so nothing found stays hidden.
 */
export function profilesWithoutClient<A extends ProfileAccount>(
  accounts: readonly A[],
  inAClient: ReadonlySet<string>,
): Profile<A>[] {
  return formProfiles(accounts.filter((a) => !inAClient.has(a.id)))
}
