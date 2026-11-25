import { addDays, monthGrid, weekOf, type LocalDate } from '@app/domain'
import type { CalendarPost, LabelDto } from '@app/contracts'

// The calendar's period and days (spec §11.4, plan 09 Task 3): the month as the 6×7 days of its
// grid, the week from Monday, the list as pages of 42 days from a day, all on the agency's wall
// dates (D-58). No zone here: the server already put every post on its day.

/** The views drawn from a period: the month's grid, the week and the list. */
export type PeriodView = 'month' | 'week' | 'list'

/** The days of a page of the list: as many as a month's grid, the most one read gives. */
export const LIST_PAGE = 42

export interface Period {
  from: LocalDate
  to: LocalDate
  days: LocalDate[]
}

/** The days a view shows around `date`: the month's 42, the 7 of its week, the list's 42 from it. */
export function periodOf(view: PeriodView, date: LocalDate): Period {
  const days =
    view === 'month'
      ? monthGrid(date.slice(0, 7))
      : view === 'week'
        ? weekOf(date)
        : Array.from({ length: LIST_PAGE }, (_, i) => addDays(date, i))
  return { from: days[0] as LocalDate, to: days.at(-1) as LocalDate, days }
}

/**
 * The day the arrows lead to: the 1st of the month before or after, the same weekday, or the page
 * of the list before or after.
 */
export function shiftDate(view: PeriodView, date: LocalDate, step: -1 | 1): LocalDate {
  if (view === 'week') return addDays(date, 7 * step)
  if (view === 'list') return addDays(date, LIST_PAGE * step)
  const [y, m] = date.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + step, 1))
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

const utcDay = (date: LocalDate) => new Date(`${date}T00:00:00Z`)
const MONTH = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_NAME = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' })
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * What the bar says: «Novembre 2026» for a month; for a week «16–22 novembre 2026», «30 nov – 6
 * dic 2026» across two months, «28 dic 2026 – 3 gen 2027» across two years; the list's days the
 * same way.
 */
export function periodLabel(view: PeriodView, date: LocalDate): string {
  if (view === 'month') return capital(MONTH.format(utcDay(date)))
  const { from, to } = periodOf(view, date)
  const [a, b] = [utcDay(from), utcDay(to)]
  const [ya, yb] = [a.getUTCFullYear(), b.getUTCFullYear()]
  if (a.getUTCMonth() === b.getUTCMonth())
    return `${String(a.getUTCDate())}–${String(b.getUTCDate())} ${MONTH_NAME.format(b)} ${String(yb)}`
  const day = (d: Date) => `${String(d.getUTCDate())} ${MONTH_SHORT.format(d).replace('.', '')}`
  return ya === yb
    ? `${day(a)} – ${day(b)} ${String(yb)}`
    : `${day(a)} ${String(ya)} – ${day(b)} ${String(yb)}`
}

type Dated = Pick<CalendarPost, 'localDate' | 'localTime' | 'id'>

/**
 * The posts of each day, by time; a draft with a day and no time goes last. Same time: the order
 * the server gave, so the page does not jump at each read.
 */
export function postsByDay<T extends Dated>(posts: readonly T[]): Map<LocalDate, T[]> {
  const days = new Map<LocalDate, T[]>()
  for (const p of posts) {
    if (!p.localDate) continue
    const list = days.get(p.localDate) ?? []
    list.push(p)
    days.set(p.localDate, list)
  }
  for (const list of days.values())
    list.sort((a, b) => (a.localTime ?? '99:99').localeCompare(b.localTime ?? '99:99'))
  return days
}

/**
 * How many cards a day of the month shows in its room: all of them up to `room`, else one less
 * and «+N» in the last place (a «+1» never takes the place of the card it hides).
 */
export function shownInDay(count: number, room: number): { shown: number; more: number } {
  if (count <= room) return { shown: count, more: 0 }
  return { shown: room - 1, more: count - room + 1 }
}

/** What a card of the calendar shows, worked out once by the page for every view. */
export interface CalendarCardInfo {
  /** a post, or a content of the plan still to prepare (a dashed card, §11.12) */
  kind: 'post' | 'plan'
  id: string
  date: LocalDate | null
  /** «18:00»; null for a draft with a day and no time */
  time: string | null
  title: string
  client: string
  /** null for a content of the plan */
  status: CalendarPost['status'] | null
  /** «Programmato», «1 non uscito», «Da preparare»… */
  state: string
  tone: 'neutral' | 'success' | 'info' | 'warning' | 'danger'
  draft: boolean
  thumb: string | null
  type: CalendarPost['type']
  platforms: ('instagram' | 'facebook')[]
  labels: { id: string; name: string; color: LabelDto['color'] }[]
  /**
   * the post's page: the editor, or the outcome once it is on its way (as the list); for a content
   * of the plan, its day in the plan
   */
  to: { path: string; query: Record<string, string> }
}

/**
 * How loud a card is (Matteo 25/11: the format in place of the dot, the state only where it asks
 * to be looked at): `alert` a post that did not go out or has a problem, `draft` a draft with a
 * day, `plan` a content still to prepare, `done` a post already out (quieter), `normal` the rest.
 */
export type CardLook = 'alert' | 'draft' | 'plan' | 'done' | 'normal'

export function cardLook(card: Pick<CalendarCardInfo, 'kind' | 'status' | 'tone'>): CardLook {
  if (card.kind === 'plan') return 'plan'
  if (card.tone === 'danger' || card.tone === 'warning') return 'alert'
  if (card.status === 'draft') return 'draft'
  if (card.status === 'published') return 'done'
  return 'normal'
}

type Translate = (key: string, named: Record<string, unknown>, plural: number) => string

/** What a day holds, for its name: «3 post», and «1 da preparare» when the plan has some. */
export function dayCount(cards: readonly Pick<CalendarCardInfo, 'kind'>[], t: Translate): string[] {
  const planned = cards.filter((c) => c.kind === 'plan').length
  const posts = cards.length - planned
  return [
    t('calendar.posts', { n: posts }, posts),
    ...(planned > 0 ? [t('calendar.planned', { n: planned }, planned)] : []),
  ]
}

/** The groups of the list (plan 09 Scelta 2), ahead and behind today. */
export type ListGroup =
  'before' | 'earlierThisWeek' | 'yesterday' | 'today' | 'tomorrow' | 'thisWeek' | 'later'

/**
 * Where a day goes in the list: «Oggi», «Domani», «Questa settimana», «Più avanti» ahead, and
 * «Ieri», «Questa settimana», «Prima» behind; the week is today's, from Monday to Sunday.
 */
export function listGroupOf(date: LocalDate, today: LocalDate): ListGroup {
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  if (date === addDays(today, -1)) return 'yesterday'
  const week = weekOf(today)
  const [monday, sunday] = [week[0] as LocalDate, week.at(-1) as LocalDate]
  if (date > today) return date <= sunday ? 'thisWeek' : 'later'
  return date >= monday ? 'earlierThisWeek' : 'before'
}
