import type { CalendarEntry, CalendarPost } from '@app/contracts'
import {
  localDateOf,
  parseCalendarQuery,
  toCalendarQuery,
  type CalendarFilters,
  type CalendarQuery,
  type LocalDate,
} from '@app/domain'
import { periodOf, shiftDate, type PeriodView } from '~/utils/calendar'

export type CalendarPostRow = CalendarPost & { marks: string[] }

interface CalendarResponse {
  timeZone: string
  from: LocalDate
  to: LocalDate
  posts: CalendarPostRow[]
  entries: CalendarEntry[]
  truncated: boolean
}

/** The views this page draws; the address may name others («griglia», stage 9 Task 12). */
const DRAWN: readonly PeriodView[] = ['month', 'week']

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
  const view = computed<PeriodView>(() => {
    const asked = query.value.view
    return asked && (DRAWN as readonly string[]).includes(asked) ? (asked as PeriodView) : 'month'
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
  const apiQuery = computed(() => {
    const f = filters.value
    const q: Record<string, string> = { from: period.value.from, to: period.value.to }
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
    if (f.quick && f.quick !== 'today' && f.quick !== 'this_week') q['quick'] = f.quick
    if (f.show !== 'both') q['show'] = f.show
    return q
  })

  const data = ref<CalendarResponse | null>(null)
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  let running: AbortController | null = null
  async function load() {
    // read in the browser only, as the panel's other reads (`server: false`)
    if (import.meta.server) return
    running?.abort()
    const mine = new AbortController()
    running = mine
    status.value = 'pending'
    try {
      const res = await $fetch<CalendarResponse>(org.api('/calendar'), {
        query: apiQuery.value,
        signal: mine.signal,
      })
      if (running !== mine) return
      data.value = res
      status.value = 'success'
    } catch {
      if (running !== mine) return
      status.value = 'error'
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

  /** The posts of the period shown (the last read until the next arrives). */
  const posts = computed(() => data.value?.posts ?? [])
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
    reload: load,
    setView,
    step,
    toToday,
    setFilters,
    clearFilters,
  }
}
