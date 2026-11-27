import { trashBatches, type TrashItem } from '~/utils/trash'

/**
 * «Elimina», «Ripristina», «Elimina per sempre» and «Svuota» (plan 09 Scelta 12, D-124): one
 * place for the list, the calendar and the editor. «Elimina» asks nothing: the notice at the
 * bottom says «Bozza eliminata · Annulla» for five seconds, and «Annulla» gives the posts back.
 * The notice outlives the page, so the editor can go back to the list and the undo still works.
 * Each call throws the server's refusal: the caller says why.
 */
export function useTrash() {
  const org = useOrganization()
  const { call, failure } = useApi()
  const { t } = useI18n()
  const notice = useNotice()

  const route = (workspaceId: string, what: 'trash' | 'restore' | 'purge') =>
    org.api(`/workspaces/${encodeURIComponent(workspaceId)}/posts/${what}`)

  async function each(what: 'trash' | 'restore', items: readonly TrashItem[]) {
    const moved: string[] = []
    for (const b of trashBatches(items)) {
      const res = await call<{ postIds: string[] }>('POST', route(b.workspaceId, what), {
        postIds: b.ids,
      })
      moved.push(...res.postIds)
    }
    return moved
  }

  /**
   * «Elimina»: to «Eliminati» at once, then the notice with «Annulla». `changed` runs after the
   * move and after the undo, so the page reads again what it shows.
   */
  async function trash(items: readonly TrashItem[], changed?: () => unknown): Promise<void> {
    if (items.length === 0) return
    await each('trash', items)
    const n = items.length
    const drafts = items.every((i) => !i.cancelled)
    notice.show({
      message: drafts ? t('trash.trashedDrafts', { n }, n) : t('trash.trashedPosts', { n }, n),
      actionLabel: t('trash.undo'),
      action: async () => {
        try {
          await each('restore', items)
          notice.show({ message: t('trash.undone', { n }, n) })
        } catch (e) {
          notice.show({
            message: t('trash.undoFailed', { reason: failure(e).message }),
            failed: true,
          })
        }
        await changed?.()
      },
    })
    await changed?.()
  }

  /** «Ripristina»: back where they were, as they were. */
  async function restore(items: readonly TrashItem[]): Promise<void> {
    if (items.length === 0) return
    await each('restore', items)
    const n = items.length
    notice.show({ message: t('trash.restored', { n }, n) })
  }

  /** «Elimina per sempre» of the posts chosen, already in «Eliminati»: gives how many went. */
  async function purge(items: readonly TrashItem[]): Promise<number> {
    let deleted = 0
    for (const b of trashBatches(items)) {
      const res = await call<{ deleted: number }>('POST', route(b.workspaceId, 'purge'), {
        postIds: b.ids,
      })
      deleted += res.deleted
    }
    notice.show({ message: t('trash.purged', { n: deleted }, deleted) })
    return deleted
  }

  /** «Svuota»: everything the person may delete in «Eliminati» of these clients. */
  async function empty(workspaceIds: readonly string[]): Promise<number> {
    let deleted = 0
    for (const id of new Set(workspaceIds)) {
      const res = await call<{ deleted: number }>('POST', route(id, 'purge'), { all: true })
      deleted += res.deleted
    }
    notice.show({ message: t('trash.purged', { n: deleted }, deleted) })
    return deleted
  }

  return { trash, restore, purge, empty }
}
