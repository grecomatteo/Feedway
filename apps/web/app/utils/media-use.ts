import type { PostResponse } from '@app/contracts'
import { formatDate, formatRelative } from './format-date.ts'

type PostStatus = PostResponse['status']
/** Still going out without anyone's hand (`isGoingOut` of @app/domain). */
const GOING_OUT = new Set<PostStatus>(['scheduled', 'publishing', 'paused'])
/** Gone out, all or in part (plan 07 Scelta 5). */
const GONE_OUT = new Set<PostStatus>(['published', 'partial', 'problem'])

/**
 * What the library says about a file's posts (D-18, D-80): the use and the reason come decided
 * by the server (`usedIn`, `deleteBlockedBy`, the rules of `@app/domain`); here they only become
 * words, with the day in the post's own zone (D-58). No component formats these dates itself.
 */

type Translate = (key: string, named?: Record<string, unknown>) => string

export interface MediaUseView {
  status: PostStatus
  scheduledAt: string | null
  timezone: string
  count: number
  /** every post that uses it is in «Eliminati» (plan 09 Scelta 12) */
  trashed?: boolean
}

export interface DeleteBlockView {
  /** the state of the nearest post that keeps the file (R10) */
  reason: 'in_scheduled_post' | 'in_publishing_post' | 'in_paused_post' | 'in_failed_post'
  scheduledAt: string | null
  timezone: string
  count: number
}

/**
 * «Nel post di oggi, 18:00», «In una bozza», «Pubblicato il 18 novembre», «In 3 post», «In una
 * bozza eliminata»; null when no
 * post uses the file.
 */
export function mediaUseLabel(
  use: MediaUseView | null,
  t: Translate,
  now = new Date(),
): string | null {
  if (!use) return null
  // the nearest use is a post in «Eliminati» only when every use is (D-124.13)
  if (use.trashed)
    return use.count > 1
      ? t('library.inPosts.trashedMany', { n: use.count })
      : t('library.inPosts.trashed')
  if (GOING_OUT.has(use.status) && use.scheduledAt)
    return t('library.inPosts.scheduled', {
      when: formatRelative(use.scheduledAt, { timeZone: use.timezone, now }),
    })
  if (GONE_OUT.has(use.status) && use.scheduledAt)
    return t('library.inPosts.published', {
      day: formatDate(use.scheduledAt, { timeZone: use.timezone, now }),
    })
  if (use.count > 1) return t('library.inPosts.many', { n: use.count })
  if (use.status === 'failed') return t('library.inPosts.notOut')
  return t(`library.inPosts.${use.status === 'cancelled' ? 'cancelled' : 'draft'}`)
}

/** «Non si può eliminare: è in un post programmato per oggi alle 18:00.» */
export function deleteBlockText(block: DeleteBlockView, t: Translate, now = new Date()): string {
  const when = block.scheduledAt
    ? formatRelative(block.scheduledAt, { timeZone: block.timezone, sentence: true, now })
    : '—'
  return block.count > 1
    ? t(`library.deleteBlocked.${block.reason}.many`, { n: block.count, when })
    : t(`library.deleteBlocked.${block.reason}.one`, { when })
}

/** What to do so the file can be deleted, by the post that keeps it (R10). */
export const deleteBlockFix = (block: DeleteBlockView, t: Translate): string =>
  t(`library.deleteBlocked.${block.reason}.fix`)

/** Why a folder is not deleted: how many of its files are in scheduled posts. */
export function folderBlockText(files: number, t: Translate): string {
  return files > 1
    ? t('library.folders.deleteBlocked.many', { n: files })
    : t('library.folders.deleteBlocked.one')
}
