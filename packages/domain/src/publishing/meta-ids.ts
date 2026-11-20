// What the worker keeps in `post_targets.meta_ids` besides the platform's own ids (plan 07 P2):
// after a change of the post during the preparation, the ids of the old round wait under one
// key of their own, for the next preparation to throw them away on the platform (`discard`).

/** The key of the ids to throw away; a platform's ids never start with `_`. */
export const DISCARD_KEY = '_discard'

type Ids = Readonly<Record<string, unknown>>

/** The platform's ids of this round, without those to throw away; null when there are none. */
export function roundIds(metaIds: Ids | null): Record<string, unknown> | null {
  if (metaIds === null) return null
  const ids = Object.fromEntries(Object.entries(metaIds).filter(([key]) => key !== DISCARD_KEY))
  return Object.keys(ids).length === 0 ? null : ids
}

/** The ids of an old round to throw away; null when there are none. */
export function idsToDiscard(metaIds: Ids | null): Record<string, unknown> | null {
  const old = metaIds?.[DISCARD_KEY]
  return typeof old === 'object' && old !== null && !Array.isArray(old)
    ? (old as Record<string, unknown>)
    : null
}

/** The ids of this round saved by the platform, keeping those still to throw away. */
export function withRoundIds(metaIds: Ids | null, ids: Ids): Record<string, unknown> {
  const old = idsToDiscard(metaIds)
  return old === null ? { ...ids } : { ...ids, [DISCARD_KEY]: old }
}
