import { formatRelative } from './format-date.ts'

/**
 * What the library says about a file's posts (D-18, D-80): the use and the reason come decided
 * by the server (`usedIn`, `deleteBlockedBy`, the rules of `@app/domain`); here they only become
 * words, with the day in the post's own zone (D-58). No component formats these dates itself.
 */

type Translate = (key: string, named?: Record<string, unknown>) => string

export interface MediaUseView {
  status: 'draft' | 'scheduled' | 'cancelled'
  scheduledAt: string | null
  timezone: string
  count: number
}

export interface DeleteBlockView {
  scheduledAt: string | null
  timezone: string
  count: number
}

/** «Nel post di oggi, 18:00», «In una bozza», «In 3 post»; null when no post uses the file. */
export function mediaUseLabel(
  use: MediaUseView | null,
  t: Translate,
  now = new Date(),
): string | null {
  if (!use) return null
  if (use.status === 'scheduled' && use.scheduledAt)
    return t('library.inPosts.scheduled', {
      when: formatRelative(use.scheduledAt, { timeZone: use.timezone, now }),
    })
  if (use.count > 1) return t('library.inPosts.many', { n: use.count })
  return t(`library.inPosts.${use.status === 'cancelled' ? 'cancelled' : 'draft'}`)
}

/** «Non si può eliminare: è in un post programmato per oggi alle 18:00.» */
export function deleteBlockText(block: DeleteBlockView, t: Translate, now = new Date()): string {
  const when = block.scheduledAt
    ? formatRelative(block.scheduledAt, { timeZone: block.timezone, sentence: true, now })
    : '—'
  return block.count > 1
    ? t('library.deleteBlocked.many', { n: block.count, when })
    : t('library.deleteBlocked.one', { when })
}

/** Why a folder is not deleted: how many of its files are in scheduled posts. */
export function folderBlockText(files: number, t: Translate): string {
  return files > 1
    ? t('library.folders.deleteBlocked.many', { n: files })
    : t('library.folders.deleteBlocked.one')
}
