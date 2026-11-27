import type { FetchError } from 'ofetch'
import type { CalendarPost, GridPublished } from '@app/contracts'
import { keepGridPictures, type GivenPictures } from '~/utils/calendar-grid'
import { ruleMessage } from '~/utils/rule-message'

export interface GridResponse {
  account: {
    id: string
    platform: 'instagram'
    name: string
    username: string | null
    avatarKey: string | null
  }
  timeZone: string
  /** latest first: the one furthest ahead is the first place of the grid */
  scheduled: CalendarPost[]
  published:
    | { ok: true; items: GridPublished[] }
    | { ok: false; reason: 'unreachable' | 'rejected' | 'unavailable' }
}

interface SwapResponse {
  posts: { id: string; version: number; scheduledAt: string }[]
}

/**
 * The tokens of the pictures open for five minutes from the server's answer (D-123.32): a grid
 * read longer ago than this is read again before its pictures are asked for.
 */
const PICTURES_FRESH_MS = 4 * 60_000

interface ErrorReport {
  error?: { code?: string; reason?: string; report?: { outcomes?: unknown[] } }
}

/**
 * Instagram's grid of one account of the client (spec §11.5, plan 09 Task 12): read at every
 * opening (the posts out come from Meta, never kept), and the swap of two scheduled posts, both
 * or neither (`POST …/calendar/grid/swap`). «Annulla» for five seconds is the same swap again,
 * with the versions the first one gave back.
 */
export function useCalendarGrid(scope: {
  workspaceId: Ref<string | null>
  accountId: Ref<string | null>
}) {
  const org = useOrganization()
  const { call, failure } = useApi()
  const { t } = useI18n()

  const data = ref<GridResponse | null>(null)
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  let running: AbortController | null = null
  /** when the tokens of the pictures shown were given, on this device's clock */
  let readAt = 0
  /**
   * The tokens given for each account, while fresh: a grid read again (after a swap, back on an
   * account) keeps the ones of its pictures, so their addresses stay and the browser's copies
   * serve them instead of new downloads (each token is new, even for the same picture).
   */
  const given = new Map<string, GivenPictures>()
  function keepPictures(accountId: string, res: GridResponse): GridResponse {
    const out = res.published
    const kept = keepGridPictures(
      given,
      accountId,
      out.ok ? out.items : null,
      Date.now(),
      PICTURES_FRESH_MS,
    )
    readAt = kept.at
    return kept.items ? { ...res, published: { ok: true, items: kept.items } } : res
  }
  const base = () =>
    org.api(`/workspaces/${encodeURIComponent(scope.workspaceId.value ?? '')}/calendar/grid`)

  /** `quiet`: what is shown stays while the new grid arrives (after a swap) */
  async function load(quiet = false) {
    if (import.meta.server) return
    running?.abort()
    const accountId = scope.accountId.value
    if (!scope.workspaceId.value || !accountId) {
      data.value = null
      status.value = 'idle'
      return
    }
    const mine = new AbortController()
    running = mine
    if (!quiet || data.value?.account.id !== accountId) {
      data.value = null
      status.value = 'pending'
    }
    try {
      const res = await $fetch<GridResponse>(`${base()}/${encodeURIComponent(accountId)}`, {
        signal: mine.signal,
      })
      if (running !== mine) return
      data.value = keepPictures(accountId, res)
      status.value = 'success'
    } catch {
      if (running !== mine) return
      // a failed read after a swap keeps the grid shown; the first one says it failed
      if (!quiet || data.value === null) status.value = 'error'
    }
  }
  watch(
    () => `${scope.workspaceId.value ?? ''} ${scope.accountId.value ?? ''}`,
    () => void load(),
    { immediate: true },
  )
  /**
   * The grid shown is read again, quietly, when its pictures' tokens may have expired: true when
   * it is (a picture that did not arrive then gets a new address instead of its sign).
   */
  function refreshIfStale(): boolean {
    const shown = data.value?.published
    if (status.value !== 'success' || Date.now() - readAt < PICTURES_FRESH_MS) return false
    // nothing to renew: no call to Meta for it
    if (!shown?.ok || shown.items.every((m) => m.picture === null)) return false
    // once: the pictures failing together ask for one reading, with new tokens
    readAt = Date.now()
    const accountId = scope.accountId.value
    if (accountId) given.delete(accountId)
    void load(true)
    return true
  }
  const wake = () => {
    if (document.visibilityState === 'visible') refreshIfStale()
  }
  onMounted(() => {
    document.addEventListener('visibilitychange', wake)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', wake)
    running?.abort()
  })

  /** the picture of a post out, through the server (P4), from the token the grid gave */
  const thumbnailOf = (picture: string) =>
    `${base()}/${encodeURIComponent(scope.accountId.value ?? '')}/pictures/${encodeURIComponent(picture)}`

  const toast = reactive({ open: false, message: '', action: '' })
  let undo: (() => Promise<void>) | null = null
  async function tell(message: string, back: (() => Promise<void>) | null) {
    undo = back
    toast.open = false
    await nextTick()
    Object.assign(toast, { open: true, message, action: back ? t('calendar.grid.undo') : '' })
  }
  async function runUndo() {
    const back = undo
    undo = null
    if (back) await back()
  }

  const problem = ref<string | null>(null)
  function why(e: unknown): string {
    const body = (e as FetchError<ErrorReport> | undefined)?.data?.error
    if (body?.reason === 'post_version_conflict') return t('calendar.grid.changed')
    if (body?.reason === 'post_not_scheduled' || body?.reason === 'post_not_in_grid')
      return t('calendar.grid.gone')
    if (body?.reason === 'post_not_schedulable') {
      const block = (body.report?.outcomes ?? []).find(
        (o): o is Parameters<typeof ruleMessage>[0] =>
          typeof o === 'object' && o !== null && (o as { level?: unknown }).level === 'block',
      )
      return block ? ruleMessage(block, t).title : t('posts.actions.notSchedulable')
    }
    return failure(e).message
  }

  const swapping = ref(false)
  /**
   * The two posts swap their times on the grid's account; false when the server said no (the
   * reason in `problem`). The grid is read again before another swap may start, so the next one
   * carries the versions this one left. `on`: the account of the swap being undone.
   */
  async function swap(
    a: { id: string; version: number },
    b: { id: string; version: number },
    undoable = true,
    on = scope.accountId.value,
  ): Promise<boolean> {
    if (swapping.value || !on || on !== scope.accountId.value) return false
    swapping.value = true
    problem.value = null
    try {
      const res = await call<SwapResponse>('POST', `${base()}/swap`, {
        accountId: on,
        a: { postId: a.id, version: a.version },
        b: { postId: b.id, version: b.version },
      })
      const version = (id: string) => res.posts.find((p) => p.id === id)?.version ?? 0
      void tell(
        undoable ? t('calendar.grid.swapped') : t('calendar.grid.undone'),
        undoable
          ? async () => {
              await swap(
                { id: a.id, version: version(a.id) },
                { id: b.id, version: version(b.id) },
                false,
                on,
              )
            }
          : null,
      )
      return true
    } catch (e) {
      problem.value = t('calendar.grid.failed', { reason: why(e) })
      return false
    } finally {
      // the order and the versions as the server has them now, before the next swap
      await load(true)
      swapping.value = false
    }
  }
  // another account: what was said, and its «Annulla», were about the one left
  watch(
    () => scope.accountId.value,
    () => {
      problem.value = null
      undo = null
      toast.open = false
    },
  )

  return {
    data,
    status,
    load,
    refreshIfStale,
    thumbnailOf,
    swap,
    swapping,
    problem,
    toast,
    runUndo,
  }
}
