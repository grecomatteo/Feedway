import type { CalendarEntry, CalendarPost } from '@app/contracts'
import {
  addDays,
  localDateOf,
  parseCalendarQuery,
  toCalendarQuery,
  type CalendarFilters,
  type CalendarQuery,
  type LocalDate,
} from '@app/domain'
import { LIST_PAGE, periodOf, shiftDate, type PeriodView } from '~/utils/calendar'

export type CalendarPostRow = CalendarPost & { marks: string[] }

interface CalendarResponse {
  timeZone: string
  from: LocalDate
  to: LocalDate
  posts: CalendarPostRow[]
  entries: CalendarEntry[]
  truncated: boolean
}

interface DraftsResponse {
  timeZone: string
  items: CalendarPost[]
  truncated: boolean
}

/** The views this page draws; the address may name others («griglia», stage 9 Task 12). */
const DRAWN: readonly PeriodView[] = ['month', 'week', 'list']

/**
 * The calendar of the page (spec §11.4, plan 09 Task 3): view, day and filters live in the
 * address (`?vista=settimana&da=2026-11-19&stato=programmato`, the domain's words), so a copied
 * link opens the same calendar and a reload keeps it. The period is read with one request
 * (`GET …/calendar`, at most 42 days); while the next one is on its way the page keeps the last,
 * so moving from month to month does not flash empty.
 *
 * `scope` is the context (§14.6): a client, and a profile's accounts within it.
 */
export function useCalendar(scope: {
  workspaceId: Ref<string | null>
  accountIds: Ref<readonly string[] | null>
  /** the context is known (the clients and the profile read): before, no read */
  ready: Ref<boolean>
}) {
  const route = useRoute()
  const router = useRouter()
  const org = useOrganization()
  const api = useApi()

  const timeZone = computed(() => org.organization.value?.timezone ?? 'Europe/Rome')
  // «oggi» of the agency (D-58), counted again when the tab comes back on another day
  const now = ref(new Date())
  const today = computed(() => localDateOf(now.value, timeZone.value))
  const wake = () => {
    if (document.visibilityState === 'visible') now.value = new Date()
  }
  onMounted(() => {
    document.addEventListener('visibilitychange', wake)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', wake)
  })

  const query = computed<CalendarQuery>(() => parseCalendarQuery(route.query))
  // the month on a computer, the list under 768 px (§11.4); read once, as the page opens
  const fallback: PeriodView =
    import.meta.client && window.matchMedia('(max-width: 47.99rem)').matches ? 'list' : 'month'
  const view = computed<PeriodView>(() => {
    const asked = query.value.view
    return asked && (DRAWN as readonly string[]).includes(asked) ? (asked as PeriodView) : fallback
  })
  const date = computed<LocalDate>(() => query.value.date ?? today.value)
  const period = computed(() => periodOf(view.value, date.value))
  /**
   * The filters that apply in this context: the clients only in «Tutti i clienti»; profiles,
   * authors and labels only inside a client, where their choices are offered. A filter left in
   * the address by the other context (the selector keeps it) is neither read nor counted.
   */
  const filters = computed<CalendarFilters>(() => {
    const f = query.value.filters
    return scope.workspaceId.value
      ? { ...f, workspaceIds: [] }
      : { ...f, accountIds: [], authorIds: [], labelIds: [] }
  })

  /** The address with these changes; the context (`spazio`, `profilo`) stays. */
  function go(change: Partial<CalendarQuery>, replace = false) {
    const next: CalendarQuery = { ...query.value, ...change }
    // today needs no date in the address: «Oggi» gives a link that stays on the day it is opened
    if (next.date === today.value) next.date = null
    const { spazio, profilo } = route.query
    const context: Record<string, string> = {}
    if (typeof spazio === 'string') context['spazio'] = spazio
    if (typeof profilo === 'string') context['profilo'] = profilo
    const to = { path: route.path, query: { ...context, ...toCalendarQuery(next) } }
    return replace ? router.replace(to) : router.push(to)
  }
  const setView = (v: PeriodView) => go({ view: v })
  const step = (by: -1 | 1) => go({ date: shiftDate(view.value, date.value, by) })
  const toToday = () => go({ date: null })
  const setFilters = (change: Partial<CalendarFilters>) =>
    go({ filters: { ...filters.value, ...change } }, true)
  const clearFilters = () =>
    go(
      {
        filters: {
          ...filters.value,
          workspaceIds: [],
          accountIds: [],
          platforms: [],
          types: [],
          statuses: [],
          authorIds: [],
          labelIds: [],
          quick: null,
          show: 'both',
        },
      },
      true,
    )

  // ---- the read: the address in the API's English names
  /** The filters in the API's names, without the period: the drafts are read with these. */
  const filterQuery = computed(() => {
    const f = filters.value
    const q: Record<string, string> = {}
    const list = (key: string, values: readonly string[]) => {
      if (values.length > 0) q[key] = values.join(',')
    }
    if (scope.workspaceId.value) q['workspaceId'] = scope.workspaceId.value
    else list('workspaceIds', f.workspaceIds)
    // a profile of the context narrows to its accounts, within the ones chosen in the filter
    const own = scope.accountIds.value
    const picked = own ? f.accountIds.filter((a) => own.includes(a)) : f.accountIds
    list('accountIds', own && picked.length === 0 ? own : picked)
    list('platforms', f.platforms)
    list('types', f.types)
    list('statuses', f.statuses)
    list('authorIds', f.authorIds)
    list('labelIds', f.labelIds)
    return q
  })
  const apiQuery = computed(() => {
    const f = filters.value
    const q: Record<string, string> = {
      ...filterQuery.value,
      from: period.value.from,
      to: period.value.to,
    }
    if (f.quick && f.quick !== 'today' && f.quick !== 'this_week') q['quick'] = f.quick
    if (f.show !== 'both') q['show'] = f.show
    return q
  })

  const data = ref<CalendarResponse | null>(null)
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  /** the list's pages after the first, read with «Mostra altri» */
  const more = ref<CalendarResponse[]>([])
  const moreStatus = ref<'idle' | 'pending' | 'error'>('idle')
  let running: AbortController | null = null
  async function load() {
    // read in the browser only, as the panel's other reads (`server: false`)
    if (import.meta.server) return
    running?.abort()
    const mine = new AbortController()
    running = mine
    status.value = 'pending'
    moreStatus.value = 'idle'
    try {
      const res = await $fetch<CalendarResponse>(org.api('/calendar'), {
        query: apiQuery.value,
        signal: mine.signal,
      })
      if (running !== mine) return
      data.value = res
      more.value = []
      status.value = 'success'
    } catch {
      if (running !== mine) return
      status.value = 'error'
    }
  }
  /** «Mostra altri» of the list: the next 42 days, under the ones shown. */
  async function loadMore() {
    const last = more.value.at(-1) ?? data.value
    // not while a new period is read: the page would follow days that are being replaced
    if (!last || moreStatus.value === 'pending' || status.value === 'pending') return
    const mine = running
    moreStatus.value = 'pending'
    try {
      const res = await $fetch<CalendarResponse>(org.api('/calendar'), {
        query: { ...apiQuery.value, from: addDays(last.to, 1), to: addDays(last.to, LIST_PAGE) },
        ...(mine ? { signal: mine.signal } : {}),
      })
      if (running !== mine || (more.value.at(-1) ?? data.value) !== last) return
      more.value = [...more.value, res]
      moreStatus.value = 'idle'
    } catch {
      if (running !== mine) return
      moreStatus.value = 'error'
    }
  }
  // the context first: «Tutti i clienti» would be read for nothing while the client is unknown
  const waiting = computed(() => !scope.ready.value)
  watch(
    () => (waiting.value ? null : JSON.stringify(apiQuery.value)),
    (key) => {
      if (key !== null) void load()
    },
    { immediate: true },
  )
  onBeforeUnmount(() => running?.abort())

  // ---- the list's drafts without a date (plan 09 Scelta 2): a read of their own, with the
  // filters and without a period; a quick filter is about dated posts, and leaves them out
  const wantsDrafts = computed(() => view.value === 'list' && filters.value.quick === null)
  const drafts = ref<DraftsResponse | null>(null)
  const draftsStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  let draftsRunning: AbortController | null = null
  async function loadDrafts() {
    if (import.meta.server) return
    draftsRunning?.abort()
    if (!wantsDrafts.value) {
      drafts.value = null
      draftsStatus.value = 'idle'
      return
    }
    const mine = new AbortController()
    draftsRunning = mine
    draftsStatus.value = 'pending'
    try {
      const res = await $fetch<DraftsResponse>(org.api('/calendar/drafts'), {
        query: filterQuery.value,
        signal: mine.signal,
      })
      if (draftsRunning !== mine) return
      drafts.value = res
      draftsStatus.value = 'success'
    } catch {
      if (draftsRunning !== mine) return
      draftsStatus.value = 'error'
    }
  }
  watch(
    () =>
      waiting.value ? null : `${String(wantsDrafts.value)} ${JSON.stringify(filterQuery.value)}`,
    (key) => {
      if (key !== null) void loadDrafts()
    },
    { immediate: true },
  )
  onBeforeUnmount(() => draftsRunning?.abort())

  /**
   * «Elimina le bozze vuote»: one's own, and with `all` the others' where the person manages the
   * posts of others (the server checks each one). Gives how many went.
   */
  async function removeEmptyDrafts(all: boolean): Promise<number> {
    const res = await api.call<{ deleted: number }>(
      'POST',
      org.api('/calendar/drafts/delete-empty'),
      { ...(scope.workspaceId.value ? { workspaceId: scope.workspaceId.value } : {}), all },
    )
    await loadDrafts()
    return res.deleted
  }

  /**
   * A change of a post drawn at once, before the next read (a move, plan 09 Task 4): in the
   * period read and in the list's pages. The next read puts the server's in its place.
   */
  function patchPost(id: string, change: Partial<CalendarPostRow>) {
    const patch = (list: CalendarPostRow[]) =>
      list.map((p) => (p.id === id ? { ...p, ...change } : p))
    if (data.value) data.value = { ...data.value, posts: patch(data.value.posts) }
    more.value = more.value.map((page) => ({ ...page, posts: patch(page.posts) }))
  }

  /** The posts of the period shown (the last read until the next arrives), with the list's pages. */
  const posts = computed(() => [
    ...(data.value?.posts ?? []),
    ...more.value.flatMap((page) => page.posts),
  ])
  /** the last day read: the list's «Mostra altri» goes on from the day after */
  /** the entries (the plan's contents) of the period and of the pages added by «Mostra altri» */
  const entries = computed(() => [
    ...(data.value?.entries ?? []),
    ...more.value.flatMap((page) => page.entries),
  ])
  const readTo = computed(() => more.value.at(-1)?.to ?? data.value?.to ?? period.value.to)
  const truncated = computed(
    () => (data.value?.truncated ?? false) || more.value.some((page) => page.truncated),
  )
  const activeFilters = computed(() => {
    const f = filters.value
    return (
      f.workspaceIds.length +
      f.accountIds.length +
      f.platforms.length +
      f.types.length +
      f.statuses.length +
      f.authorIds.length +
      f.labelIds.length
    )
  })

  return {
    today,
    timeZone,
    view,
    date,
    period,
    filters,
    activeFilters,
    data,
    posts,
    status,
    truncated,
    entries,
    readTo,
    loadMore,
    moreStatus,
    drafts,
    draftsStatus,
    reloadDrafts: loadDrafts,
    removeEmptyDrafts,
    reload: load,
    patchPost,
    setView,
    step,
    toToday,
    setFilters,
    clearFilters,
  }
}
