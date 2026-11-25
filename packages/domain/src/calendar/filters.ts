import type { Platform } from '../accounts/accounts.js'
import { PUBLISHING_POST_STATUSES, type PublishingPostStatus } from '../publishing/post-status.js'
import type { PostType } from '../rules/types.js'
import { isLocalDate, localDateOf, weekOf, type LocalDate } from './dates.js'

// What the calendar shows (spec §11.4, plan 09 Task 2): the view, the period and the filters,
// kept in the address so a copied link opens the same calendar. The address speaks Italian
// (`?vista=mese&da=2026-12-01&stato=programmato`); a value it does not know is left out, never
// an error, so an old link still opens.

export const CALENDAR_VIEWS = ['month', 'week', 'list', 'grid'] as const
export type CalendarView = (typeof CALENDAR_VIEWS)[number]

/** «Mostra: Post · Piano · Entrambi» */
export const CALENDAR_SHOW = ['posts', 'plan', 'both'] as const
export type CalendarShow = (typeof CALENDAR_SHOW)[number]

export const QUICK_FILTERS = [
  'to_publish',
  'published',
  'with_problem',
  'to_prepare',
  'today',
  'this_week',
] as const
export type QuickFilter = (typeof QUICK_FILTERS)[number]

export interface CalendarFilters {
  workspaceIds: string[]
  accountIds: string[]
  platforms: Platform[]
  types: PostType[]
  statuses: PublishingPostStatus[]
  authorIds: string[]
  labelIds: string[]
  quick: QuickFilter | null
  show: CalendarShow
}

export interface CalendarQuery {
  /** null: the device's own (month on a computer, list under 768 px) */
  view: CalendarView | null
  /** the day the period holds; null: today */
  date: LocalDate | null
  filters: CalendarFilters
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  workspaceIds: [],
  accountIds: [],
  platforms: [],
  types: [],
  statuses: [],
  authorIds: [],
  labelIds: [],
  quick: null,
  show: 'both',
}

/** The words of the address for each value, in Italian. */
const VIEW_WORDS: Record<CalendarView, string> = {
  month: 'mese',
  week: 'settimana',
  list: 'elenco',
  grid: 'griglia',
}
const SHOW_WORDS: Record<CalendarShow, string> = { posts: 'post', plan: 'piano', both: 'entrambi' }
const QUICK_WORDS: Record<QuickFilter, string> = {
  to_publish: 'da-pubblicare',
  published: 'pubblicati',
  with_problem: 'con-problema',
  to_prepare: 'da-preparare',
  today: 'oggi',
  this_week: 'settimana',
}
/** The words of the post types in the panel's addresses (`?tipo=carosello`). */
export const POST_TYPE_WORDS: Readonly<Record<PostType, string>> = {
  photo: 'foto',
  carousel: 'carosello',
  reel: 'reel',
  story: 'storia',
}
const STATUS_WORDS: Record<PublishingPostStatus, string> = {
  draft: 'bozza',
  scheduled: 'programmato',
  publishing: 'in-pubblicazione',
  partial: 'parziale',
  failed: 'non-uscito',
  problem: 'problema',
  published: 'pubblicato',
  paused: 'in-pausa',
  cancelled: 'annullato',
}
const PLATFORM_WORDS: Record<Platform, string> = { instagram: 'instagram', facebook: 'facebook' }

/** The address's keys: the filters of ids take ids, the others words. */
const KEYS = {
  view: 'vista',
  date: 'da',
  workspaceIds: 'cliente',
  accountIds: 'account',
  platforms: 'piattaforma',
  types: 'tipo',
  statuses: 'stato',
  authorIds: 'autore',
  labelIds: 'etichetta',
  quick: 'rapido',
  show: 'mostra',
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** More ids than a filter of the panel ever holds: the rest is left out. */
const MAX_IDS = 50

/** A query of the address: Vue's `LocationQuery`, `URLSearchParams` read as an object… */
export type AddressQuery = Readonly<Record<string, unknown>>

/** Every value of the key, split on commas: `?stato=a,b&stato=c` gives a, b, c. */
function valuesOf(query: AddressQuery, key: string): string[] {
  const raw = query[key]
  const list = Array.isArray(raw) ? (raw as unknown[]) : [raw]
  return list.flatMap((v) => (typeof v === 'string' ? v.split(',') : [])).map((v) => v.trim())
}

function wordsOf<T extends string>(query: AddressQuery, key: string, words: Record<T, string>) {
  const byWord = new Map(Object.entries<string>(words).map(([value, word]) => [word, value as T]))
  return [
    ...new Set(valuesOf(query, key).flatMap((w) => (byWord.has(w) ? [byWord.get(w) as T] : []))),
  ]
}

const idsOf = (query: AddressQuery, key: string) =>
  [
    ...new Set(
      valuesOf(query, key)
        .filter((v) => UUID.test(v))
        .map((v) => v.toLowerCase()),
    ),
  ].slice(0, MAX_IDS)

const oneOf = <T extends string>(query: AddressQuery, key: string, words: Record<T, string>) =>
  wordsOf(query, key, words)[0] ?? null

/** The calendar an address asks for; what it does not know is left out. */
export function parseCalendarQuery(query: AddressQuery): CalendarQuery {
  const date = valuesOf(query, KEYS.date).find(isLocalDate) ?? null
  return {
    view: oneOf(query, KEYS.view, VIEW_WORDS),
    date,
    filters: {
      workspaceIds: idsOf(query, KEYS.workspaceIds),
      accountIds: idsOf(query, KEYS.accountIds),
      platforms: wordsOf(query, KEYS.platforms, PLATFORM_WORDS),
      types: wordsOf(query, KEYS.types, POST_TYPE_WORDS),
      statuses: wordsOf(query, KEYS.statuses, STATUS_WORDS),
      authorIds: idsOf(query, KEYS.authorIds),
      labelIds: idsOf(query, KEYS.labelIds),
      quick: oneOf(query, KEYS.quick, QUICK_WORDS),
      show: oneOf(query, KEYS.show, SHOW_WORDS) ?? 'both',
    },
  }
}

/**
 * The address of a calendar: only what differs from the defaults, in a fixed order, so the
 * same calendar always gives the same link.
 */
export function toCalendarQuery(q: CalendarQuery): Record<string, string> {
  const out: Record<string, string> = {}
  const f = q.filters
  if (q.view) out[KEYS.view] = VIEW_WORDS[q.view]
  if (q.date) out[KEYS.date] = q.date
  const words = <T extends string>(key: string, values: readonly T[], map: Record<T, string>) => {
    if (values.length > 0) out[key] = [...new Set(values)].map((v) => map[v]).join(',')
  }
  const ids = (key: string, values: readonly string[]) => {
    if (values.length > 0) out[key] = [...new Set(values)].join(',')
  }
  ids(KEYS.workspaceIds, f.workspaceIds)
  ids(KEYS.accountIds, f.accountIds)
  words(KEYS.platforms, f.platforms, PLATFORM_WORDS)
  words(KEYS.types, f.types, POST_TYPE_WORDS)
  words(KEYS.statuses, f.statuses, STATUS_WORDS)
  ids(KEYS.authorIds, f.authorIds)
  ids(KEYS.labelIds, f.labelIds)
  if (f.quick) out[KEYS.quick] = QUICK_WORDS[f.quick]
  if (f.show !== 'both') out[KEYS.show] = SHOW_WORDS[f.show]
  return out
}

/** Every state of a post but «Annullato»: what the calendar shows without a filter. */
export const CALENDAR_DEFAULT_STATUSES: readonly PublishingPostStatus[] =
  PUBLISHING_POST_STATUSES.filter((s) => s !== 'cancelled')

/**
 * What a quick filter asks: the states of the posts (null: any), the days (null: the period's
 * own) and what to show (null: as chosen).
 */
export interface QuickFilterScope {
  statuses: readonly PublishingPostStatus[] | null
  from: LocalDate | null
  to: LocalDate | null
  show: CalendarShow | null
}

const ANY: QuickFilterScope = { statuses: null, from: null, to: null, show: null }

/** The scope of a quick filter at `now`, with the days of the agency's zone. */
export function quickFilter(name: QuickFilter, now: Date, timeZone: string): QuickFilterScope {
  switch (name) {
    case 'to_publish':
      return { ...ANY, statuses: ['scheduled', 'publishing'] }
    case 'published':
      // «1 non uscito» went out too, on its other destinations
      return { ...ANY, statuses: ['published', 'partial'] }
    case 'with_problem':
      return { ...ANY, statuses: ['failed', 'partial', 'problem', 'paused'] }
    case 'to_prepare':
      // what the plan still asks: no post is «da preparare»
      return { ...ANY, statuses: [], show: 'plan' }
    case 'today': {
      const today = localDateOf(now, timeZone)
      return { ...ANY, from: today, to: today }
    }
    case 'this_week': {
      const week = weekOf(localDateOf(now, timeZone))
      return { ...ANY, from: week[0] ?? null, to: week[6] ?? null }
    }
  }
}

/** The states a read asks for: the filter's (or the default), within the quick filter's. */
export function calendarStatuses(
  filters: Pick<CalendarFilters, 'statuses'>,
  quick: QuickFilterScope | null,
): PublishingPostStatus[] {
  const chosen = filters.statuses.length > 0 ? filters.statuses : CALENDAR_DEFAULT_STATUSES
  const allowed = quick?.statuses
  return [...new Set(chosen)].filter((s) => !allowed || allowed.includes(s))
}
