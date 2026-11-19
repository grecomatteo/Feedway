import type { AgendaIssue, AgendaPost, ClientActivity, DraftToFinish } from '@app/contracts'

/**
 * «Da sistemare» of the whole agency (redesign R3), read once and shared: the page «Oggi», the
 * count beside «Oggi» in the sidebar and the dot of the client selector say the same thing. The
 * page narrows it to the client of the selector on its own; the server never shows a client the
 * person does not see. Counted from the browser's moment at each read, as the page.
 */
export function useAgendaIssues() {
  const org = useOrganization()
  return useFetch<{ items: AgendaIssue[] }>(() => org.api('/agenda/issues'), {
    key: () => `agenda-issues-${org.slug.value}`,
    // read at every fetch: the sidebar registers this read first, and a later refresh (the page,
    // «Riprova») must count from its own moment, not from when the panel opened
    query: {
      get from() {
        return new Date().toISOString()
      },
    },
    server: false,
    lazy: true,
  })
}

/** The issues of one client, or of every client («Tutti i clienti»). */
export function issuesOf(items: readonly AgendaIssue[], workspaceId: string | null) {
  return workspaceId === null ? [...items] : items.filter((i) => i.workspaceId === workspaceId)
}

/** Midnight of the day of `at` in the browser's zone, `days` later. */
export function dayStart(at: Date, days = 0): Date {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d
}

/** Monday of the week of `at`, at midnight. */
export function weekStart(at: Date): Date {
  const monday = (at.getDay() + 6) % 7
  return dayStart(at, -monday)
}

/** The same day, in the browser's zone. */
export const sameDay = (a: Date, b: Date) => dayStart(a).getTime() === dayStart(b).getTime()

/**
 * The reads of «Oggi»: the week of today (and tomorrow, when today is Sunday), the drafts to
 * finish and the clients' activity, for the client of the selector or for all of them.
 */
export function useAgenda(workspaceId: Ref<string | null>) {
  const org = useOrganization()
  const now = new Date()
  const from = weekStart(now)
  // tomorrow is on the list even on a Sunday, when it is in the next week
  const to = new Date(Math.max(dayStart(from, 7).getTime(), dayStart(now, 2).getTime()))
  const narrowed = () => (workspaceId.value === null ? {} : { workspaceId: workspaceId.value })
  const key = (what: string) => `agenda-${what}-${org.slug.value}-${workspaceId.value ?? 'all'}`

  const agenda = useFetch<{ items: AgendaPost[] }>(() => org.api('/agenda'), {
    key: () => key('posts'),
    query: computed(() => ({ from: from.toISOString(), to: to.toISOString(), ...narrowed() })),
    server: false,
    lazy: true,
  })
  const drafts = useFetch<{ items: DraftToFinish[]; total: number }>(
    () => org.api('/agenda/drafts'),
    {
      key: () => key('drafts'),
      query: computed(() => ({ limit: 3, ...narrowed() })),
      server: false,
      lazy: true,
    },
  )
  const clients = useClientActivity(now)
  return { now, from, to, agenda, drafts, clients }
}

/**
 * For every client the person sees with some posts: how many go out from `now`, the next one and
 * the latest change (D-88.7). «Oggi» and «Clienti» share it; a client without posts is not there.
 */
export function useClientActivity(now = new Date()) {
  const org = useOrganization()
  return useFetch<{ items: ClientActivity[] }>(() => org.api('/agenda/clients'), {
    key: () => `agenda-clients-${org.slug.value}`,
    query: { from: now.toISOString() },
    server: false,
    lazy: true,
  })
}
