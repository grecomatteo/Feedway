// Instagram's grid in the client's calendar (spec §11.5, plan 09 Task 12).

/** A scheduled post of the grid as «Scambia con…» shows it. */
export interface GridSwapPost {
  id: string
  version: number
  title: string
  /** the agency's day and time, as the calendar says them */
  when: string
  thumb: string | null
}

export interface GridAccountOption {
  id: string
  label: string
}

/**
 * The Instagram accounts whose grid the page offers: the client's, or only the profile's of the
 * context (§14.6), named by the handle as the filters name them.
 */
export function gridInstagramAccounts(
  profiles: readonly {
    accounts: readonly { id: string; platform: string; name: string; username: string | null }[]
  }[],
  profileAccountIds: readonly string[] | null,
): GridAccountOption[] {
  return profiles
    .flatMap((p) => p.accounts)
    .filter((a) => a.platform === 'instagram' && (profileAccountIds?.includes(a.id) ?? true))
    .map((a) => ({ id: a.id, label: a.username ? `@${a.username}` : a.name }))
}

export type GridSign = 'carousel' | 'reel' | 'video'

/** The sign in the corner of a place: a scheduled post by its type, a post out by its media. */
export function gridSignOf(
  m: { type: string } | { kind: 'image' | 'video' | 'carousel'; reel: boolean },
): GridSign | null {
  if ('type' in m) return m.type === 'carousel' ? 'carousel' : m.type === 'reel' ? 'reel' : null
  if (m.kind === 'carousel') return 'carousel'
  if (m.kind === 'video') return m.reel ? 'reel' : 'video'
  return null
}

/** The tokens of the pictures given for one account: when, and the token of each media. */
export interface GivenPictures {
  at: number
  pictures: Map<string, string>
}

/**
 * The posts out of a grid just read, with the tokens of the pictures already given while they
 * are fresh (D-123.32): each token is new, even for the same picture, so keeping the known ones
 * keeps their addresses and the browser's copies. A media not given yet adds its own.
 */
export function keepGridPictures<T extends { id: string; picture: string | null }>(
  given: Map<string, GivenPictures>,
  accountId: string,
  items: readonly T[] | null,
  now: number,
  freshMs: number,
): { at: number; items: T[] | null } {
  let kept = given.get(accountId)
  if (!kept || now - kept.at >= freshMs) {
    kept = { at: now, pictures: new Map() }
    given.set(accountId, kept)
  }
  const { pictures } = kept
  const out =
    items?.map((m) => {
      if (m.picture === null) return m
      const known = pictures.get(m.id)
      if (known !== undefined) return { ...m, picture: known }
      pictures.set(m.id, m.picture)
      return m
    }) ?? null
  return { at: kept.at, items: out }
}
