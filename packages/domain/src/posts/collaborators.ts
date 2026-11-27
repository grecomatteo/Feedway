// The collaborators of an Instagram post (plan 09 Scelta 13, D-125): up to 3 usernames invited
// with the post, as Meta Business Suite does. Only Instagram, never on stories; Facebook gets
// the post without them.

/** The fewest of the two numbers of Meta's documentation (3 when creating, 5 when reading). */
export const MAX_INSTAGRAM_COLLABORATORS = 3

/** An Instagram username: letters, digits, dot and underscore, at most 30 characters. */
const USERNAME = /^[A-Za-z0-9._]{1,30}$/

export const isInstagramUsername = (value: string): boolean => USERNAME.test(value)

/**
 * What the editor keeps of a name typed in the field: without spaces and the «@» in front, in
 * small letters (Instagram does not tell them apart). It may still be no username: the checks
 * say so.
 */
export const normalizeCollaborator = (value: string): string =>
  value.trim().replace(/^@+/, '').toLowerCase()

/** The same name twice, whatever the case: the first one repeated, or null. */
export function repeatedCollaborator(names: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const name of names) {
    const key = name.toLowerCase()
    if (seen.has(key)) return name
    seen.add(key)
  }
  return null
}

/** The states of an invitation as Meta reads them (`GET /{ig-media-id}/collaborators`). */
export const COLLABORATOR_STATUSES = ['pending', 'accepted', 'declined'] as const
export type CollaboratorStatus = (typeof COLLABORATOR_STATUSES)[number]
