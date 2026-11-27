import { TRASH_BATCH_MAX, daysUntilAutoTrash, showsAutoTrash, trashPurgeAt } from '@app/domain'
import type { CalendarPost } from '@app/contracts'

// «Eliminati» in the panel (plan 09 Scelta 12, D-124): who may send a post there, and the line
// a row says about it. The server decides again on every request.

const MANAGERS = ['owner', 'admin', 'manager']

/** «Elimina» for this person: a draft or a cancelled post, one's own or as a manager of posts. */
export function mayTrash(
  post: Pick<CalendarPost, 'status' | 'createdBy' | 'trashedAt'>,
  client: { myRole: string; archivedAt: string | null } | undefined,
  meId: string | null,
): boolean {
  if (!client || client.archivedAt || client.myRole === 'viewer') return false
  if (post.trashedAt !== null) return false
  if (post.status !== 'draft' && post.status !== 'cancelled') return false
  return post.createdBy === meId || MANAGERS.includes(client.myRole)
}

/** «Ripristina» and «Elimina per sempre» of a post in «Eliminati»: who could delete it. */
export function mayHandleTrashed(
  post: Pick<CalendarPost, 'createdBy'>,
  client: { myRole: string; archivedAt: string | null } | undefined,
  meId: string | null,
): boolean {
  if (!client || client.archivedAt || client.myRole === 'viewer') return false
  return post.createdBy === meId || MANAGERS.includes(client.myRole)
}

/**
 * The line of a row: «Si cancella tra 23 giorni» in «Eliminati»; «Va negli Eliminati tra 5
 * giorni» for a draft nobody touched, from 7 days before. The keys are of it.json, `n` the days.
 */
export function trashNote(
  post: Pick<CalendarPost, 'trashedAt' | 'autoTrashAt'>,
  now: Date,
): { key: 'trash.purgeIn' | 'trash.autoTrashIn'; n: number } | null {
  if (post.trashedAt !== null)
    return {
      key: 'trash.purgeIn',
      n: daysUntilAutoTrash(trashPurgeAt(new Date(post.trashedAt)), now),
    }
  const at = post.autoTrashAt === null ? null : new Date(post.autoTrashAt)
  if (at === null || !showsAutoTrash(at, now)) return null
  return { key: 'trash.autoTrashIn', n: daysUntilAutoTrash(at, now) }
}

/** A post to act on, with its client: the routes are the client's (plan 09 Scelta 12). */
export interface TrashItem {
  id: string
  workspaceId: string
  /** a cancelled post: «Post eliminato» rather than «Bozza eliminata» */
  cancelled?: boolean
}

/** The posts of each client, at most 100 per request, as the routes take them. */
export function trashBatches(
  items: readonly TrashItem[],
): { workspaceId: string; ids: string[] }[] {
  const byClient = new Map<string, string[]>()
  for (const item of items) {
    const ids = byClient.get(item.workspaceId) ?? []
    if (!ids.includes(item.id)) ids.push(item.id)
    byClient.set(item.workspaceId, ids)
  }
  return [...byClient].flatMap(([workspaceId, ids]) =>
    Array.from({ length: Math.ceil(ids.length / TRASH_BATCH_MAX) }, (_, i) => ({
      workspaceId,
      ids: ids.slice(i * TRASH_BATCH_MAX, (i + 1) * TRASH_BATCH_MAX),
    })),
  )
}
