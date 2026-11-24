import {
  DomainError,
  EMPTY_CALENDAR_FILTERS,
  calendarStatuses,
  can,
  dayBounds,
  daysBetween,
  isLocalDate,
  localDateOf,
  quickFilter,
  storedTimeZone,
  weekOf,
  type CalendarFilters,
  type LocalDate,
  type OrgActor,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { CalendarEntry, ModuleDefinition } from '../module-definition.js'
import { MODULES, calendarEntrySources, enabledModules } from '../modules.js'
import type { Clock } from '../ports/clock.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  deleteEmptyDrafts,
  listPostsInRange,
  type CalendarPostDto,
  type PostRangeFilters,
} from '../posts/index.js'
import { currentActor, workspaceNotFound } from '../workspaces/index.js'

// The calendar (spec §11.4, plan 09 Task 2, P1): one read gives what a period shows, the posts
// of the clients the person sees and the entries of the modules the agency uses, with the days
// counted in the agency's zone (D-58). The list view reads the same, plus the drafts without a
// date. No table of its own: the posts come from `posts`, the entries from the modules.

/** The longest period one read covers: the 6×7 grid of a month. */
export const CALENDAR_MAX_DAYS = 42
/** More than a month shows: beyond it the read says `truncated`. */
export const CALENDAR_MAX_ITEMS = 2000
/** The drafts without a date the list shows at once. */
export const UNDATED_DRAFTS_MAX = 200

export interface CalendarDeps {
  uow: UnitOfWork
  clock: Clock
  /** the modules that may add entries; all of them outside the tests */
  modules?: readonly ModuleDefinition[]
}

export type CalendarPost = CalendarPostDto & {
  /** the sources that mark it: ['plan'] for «dal piano» */
  marks: string[]
}

export interface CalendarDto {
  timeZone: string
  from: LocalDate
  to: LocalDate
  posts: CalendarPost[]
  entries: CalendarEntry[]
  /** more than `CALENDAR_MAX_ITEMS`: the rest is left out */
  truncated: boolean
}

export interface CalendarInput {
  /** the first and last day, both counted; the week of today in the agency's zone without */
  from?: LocalDate
  to?: LocalDate
  /** a client's calendar; every visible client without it */
  workspaceId?: string
  filters?: Partial<CalendarFilters>
}

function periodOf(from: string, to: string) {
  if (!isLocalDate(from))
    throw new DomainError('VALIDATION', 'Periodo non valido', { field: 'from' })
  if (!isLocalDate(to) || to < from)
    throw new DomainError('VALIDATION', 'Periodo non valido', { field: 'to' })
  if (daysBetween(from, to) > CALENDAR_MAX_DAYS)
    throw new DomainError(
      'VALIDATION',
      `Il periodo è al massimo di ${String(CALENDAR_MAX_DAYS)} giorni`,
      { field: 'to' },
    )
  return { from, to }
}

/**
 * The clients the read covers: one asked (archived ones too, they stay readable; not found when
 * hidden), or every visible client not archived, narrowed by the filter of the clients.
 */
async function clientsOf(
  tx: Tx,
  actor: OrgActor,
  workspaceId: string | undefined,
  narrow: readonly string[],
) {
  const current = await currentActor(tx, actor)
  const { organizationId } = current
  const visible = (await tx.workspaces.listVisible(current)).filter((w) =>
    can(current, 'workspace.view', { organizationId, workspaceId: w.id }),
  )
  if (workspaceId !== undefined) {
    const asked = isUuid(workspaceId) ? visible.find((w) => w.id === workspaceId) : undefined
    if (!asked) throw workspaceNotFound()
    return { current, ids: [asked.id] }
  }
  const wanted = new Set(narrow)
  return {
    current,
    ids: visible
      .filter((w) => w.archivedAt === null && (wanted.size === 0 || wanted.has(w.id)))
      .map((w) => w.id),
  }
}

/** The agency's zone and the modules it uses, read in the transaction. */
async function agencyOf(tx: Tx, organizationId: string, modules: readonly ModuleDefinition[]) {
  const organization = await tx.organizations.findById(organizationId)
  const settings = organization?.settings ?? {}
  return { timeZone: storedTimeZone(settings), modules: enabledModules(settings, modules) }
}

const filtersOf = (input: Partial<CalendarFilters> | undefined): CalendarFilters => ({
  ...EMPTY_CALENDAR_FILTERS,
  ...input,
})

const postFilters = (
  f: CalendarFilters,
  statuses: PostRangeFilters['statuses'],
): PostRangeFilters => ({
  statuses,
  types: f.types,
  authorIds: f.authorIds,
  accountIds: f.accountIds,
  platforms: f.platforms,
  labelIds: f.labelIds,
})

/**
 * Whether the modules' entries answer these filters: they have no state, account, author or
 * label, so a filter of the posts leaves them out; the period's quick filters and «Da
 * preparare» keep them.
 */
const entriesAnswer = (f: CalendarFilters) =>
  f.statuses.length === 0 &&
  f.accountIds.length === 0 &&
  f.platforms.length === 0 &&
  f.types.length === 0 &&
  f.authorIds.length === 0 &&
  f.labelIds.length === 0 &&
  (f.quick === null || f.quick === 'today' || f.quick === 'this_week' || f.quick === 'to_prepare')

/** What a period of the calendar shows (P1): at most 42 days and 2.000 items. */
export async function getCalendar(
  deps: CalendarDeps,
  actor: OrgActor,
  input: CalendarInput,
): Promise<CalendarDto> {
  const filters = filtersOf(input.filters)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, ids } = await clientsOf(tx, actor, input.workspaceId, filters.workspaceIds)
    const agency = await agencyOf(tx, organizationId, deps.modules ?? MODULES)
    const week = weekOf(localDateOf(deps.clock.now(), agency.timeZone))
    const period = periodOf(input.from ?? week[0] ?? '', input.to ?? input.from ?? week[6] ?? '')
    const empty: CalendarDto = {
      timeZone: agency.timeZone,
      ...period,
      posts: [],
      entries: [],
      truncated: false,
    }
    const quick = filters.quick
      ? quickFilter(filters.quick, deps.clock.now(), agency.timeZone)
      : null
    // the quick filter's days, within the period asked
    const from = quick?.from && quick.from > period.from ? quick.from : period.from
    const to = quick?.to && quick.to < period.to ? quick.to : period.to
    if (ids.length === 0 || from > to) return empty
    const show = quick?.show ?? filters.show
    const statuses = calendarStatuses(filters, quick)

    const posts =
      show === 'plan' || statuses.length === 0
        ? { items: [], truncated: false }
        : await listPostsInRange(tx, current, {
            workspaceIds: ids,
            period: (({ start, end }) => ({ from: start, to: end }))(
              dayBounds(from, to, agency.timeZone),
            ),
            timeZone: agency.timeZone,
            filters: postFilters(filters, statuses),
            limit: CALENDAR_MAX_ITEMS,
          })

    const sources = calendarEntrySources(agency.modules)
    const entries: CalendarEntry[] = []
    if (show !== 'posts' && entriesAnswer(filters))
      for (const source of sources)
        for (const entry of await source.entries(tx, { workspaceIds: ids, from, to }))
          // a module answers for the clients asked, never another
          if (ids.includes(entry.workspaceId)) entries.push({ ...entry, source: source.id })
    entries.sort(
      (a, b) =>
        a.localDate.localeCompare(b.localDate) ||
        (a.localTime ?? '24:00').localeCompare(b.localTime ?? '24:00') ||
        a.id.localeCompare(b.id),
    )
    const room = CALENDAR_MAX_ITEMS - posts.items.length
    const marks = await marksOf(
      tx,
      sources,
      posts.items.map((p) => p.id),
    )
    return {
      ...empty,
      from,
      to,
      posts: posts.items.map((p) => ({ ...p, marks: marks.get(p.id) ?? [] })),
      entries: entries.slice(0, Math.max(room, 0)),
      truncated: posts.truncated || entries.length > room,
    }
  })
}

/** The sources that mark each post (`markedPostIds`), read for the posts of the period. */
async function marksOf(
  tx: Tx,
  sources: ReturnType<typeof calendarEntrySources>,
  postIds: readonly string[],
) {
  const marks = new Map<string, string[]>()
  if (postIds.length === 0) return marks
  for (const source of sources) {
    if (!source.markedPostIds) continue
    for (const id of await source.markedPostIds(tx, postIds))
      marks.set(id, [...(marks.get(id) ?? []), source.id])
  }
  return marks
}

/** The drafts without a date of the list view (plan 09 Scelta 2), the latest changed first. */
export async function getUndatedDrafts(
  deps: Pick<CalendarDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId?: string; filters?: Partial<CalendarFilters> },
): Promise<{ timeZone: string; items: CalendarPostDto[]; truncated: boolean }> {
  const filters = filtersOf(input.filters)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, ids } = await clientsOf(tx, actor, input.workspaceId, filters.workspaceIds)
    const { timeZone } = await agencyOf(tx, organizationId, [])
    // a filter of the states without «Bozza» leaves no draft
    const statuses =
      filters.statuses.length === 0 || filters.statuses.includes('draft') ? ['draft' as const] : []
    if (ids.length === 0 || statuses.length === 0 || filters.quick !== null)
      return { timeZone, items: [], truncated: false }
    const { items, truncated } = await listPostsInRange(tx, current, {
      workspaceIds: ids,
      period: 'undated',
      timeZone,
      filters: postFilters(filters, statuses),
      limit: UNDATED_DRAFTS_MAX,
    })
    return { timeZone, items, truncated }
  })
}

/**
 * «Elimina le bozze vuote» of the list (plan 09 Scelta 2): one's own, or with `all` everyone's
 * where the person has `post.manage_others`; in the client asked, or in every visible one.
 */
export async function removeEmptyDrafts(
  deps: Pick<CalendarDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId?: string; all?: boolean },
  request: { ip: string | null },
): Promise<{ deleted: number }> {
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { current, ids } = await clientsOf(tx, actor, input.workspaceId, [])
    return deleteEmptyDrafts(tx, current, {
      workspaceIds: ids,
      all: input.all ?? false,
      ip: request.ip,
    })
  })
}
