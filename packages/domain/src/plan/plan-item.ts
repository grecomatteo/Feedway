import { DomainError } from '../errors.js'
import { isPlainDisplayName } from '../identity/display-name.js'
import { instantToZoned, zonedToInstant } from '../time/zoned.js'

// The editorial plan (spec §11.12, plan 09 Task 5): what comes out on which day, before any post
// exists. A content is a local date and an optional time in the agency's zone, never an instant:
// «il 20» stays the 20th across a change of the clocks. Every warning and notification counts
// from one instant, `referenceInstant`.

/** The four types of §13, as the posts have them. */
export const PLAN_ITEM_TYPES = ['photo', 'carousel', 'reel', 'story'] as const
export type PlanItemType = (typeof PLAN_ITEM_TYPES)[number]

export const PLAN_TITLE_MAX_LENGTH = 80
export const PLAN_NOTE_MAX_LENGTH = 2000

export interface PlanItem {
  id: string
  organizationId: string
  workspaceId: string
  /** `YYYY-MM-DD` in the agency's zone */
  localDate: string
  /** `HH:MM`; null: the whole day */
  localTime: string | null
  type: PlanItemType
  title: string
  /** for who prepares it: never in the calendar, notifications, digest or client link */
  note: string
  /** the post it became; null while to prepare (or after the post was deleted) */
  postId: string | null
  createdBy: string
  updatedBy: string
  version: number
  createdAt: Date
  updatedAt: Date
}

/** What the plan reads of its post, through `getStatuses` and the post itself. */
export interface PlanPostFacts {
  status: string
  /** null: a draft without a date */
  scheduledAt: Date | null
}

export type PlanItemState = 'to_prepare' | 'due_soon' | 'late' | 'prepared'

const HOUR_MS = 3_600_000
/** «Mancano meno di 36 ore» */
export const PLAN_DUE_SOON_MS = 36 * HOUR_MS
/** the notification, a day before a content with a time */
export const PLAN_NOTICE_BEFORE_MS = 24 * HOUR_MS
/** the time of the notification of a content without one, the day before (never at night) */
export const PLAN_NOTICE_TIME = '09:00'
/** the end of a day without a time */
export const PLAN_END_OF_DAY = '23:59'

const HIDDEN_IN_NOTE = /[\p{Cc}‪-‮⁦-⁩]/u

/** A title as stored: trimmed, 1 to 80 characters of plain text; null when not acceptable. */
export function planTitle(raw: string): string | null {
  const title = raw.trim().replace(/\s+/g, ' ')
  const length = Array.from(title).length
  if (length < 1 || length > PLAN_TITLE_MAX_LENGTH) return null
  return isPlainDisplayName(title) ? title : null
}

/** A note as stored: trimmed, new lines kept, up to 2.000 characters; null when not acceptable. */
export function planNote(raw: string): string | null {
  const note = raw.trim().replace(/\r\n?/g, '\n')
  if (Array.from(note).length > PLAN_NOTE_MAX_LENGTH) return null
  return HIDDEN_IN_NOTE.test(note.replace(/\n/g, '')) ? null : note
}

/**
 * The instant every warning counts from (rule 2): the date and time, or 23:59 without a time,
 * in the agency's zone with the rule of §9.2 (a missing time moves on, a double one is the first).
 */
export function referenceInstant(
  localDate: string,
  localTime: string | null,
  timeZone: string,
): Date {
  return zonedToInstant(localDate, localTime ?? PLAN_END_OF_DAY, timeZone).instant
}

/** Whether the post still stands for the content: a cancelled post gives it back (rule 5). */
export const isPreparedBy = (post: PlanPostFacts | null): post is PlanPostFacts =>
  post !== null && post.status !== 'cancelled'

/**
 * The state of a content at `now`: prepared while its post stands; otherwise late after the
 * reference instant, due soon from 36 hours before it, to prepare before then.
 */
export function planItemState(
  item: Pick<PlanItem, 'localDate' | 'localTime'>,
  post: PlanPostFacts | null,
  now: Date,
  timeZone: string,
): PlanItemState {
  if (isPreparedBy(post)) return 'prepared'
  const reference = referenceInstant(item.localDate, item.localTime, timeZone).getTime()
  if (now.getTime() > reference) return 'late'
  if (now.getTime() >= reference - PLAN_DUE_SOON_MS) return 'due_soon'
  return 'to_prepare'
}

const previousDay = (localDate: string) => {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number]
  const day = new Date(Date.UTC(y, m - 1, d - 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(day.getUTCFullYear())}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`
}

/**
 * When «Contenuto da preparare entro domani» goes out (§11.12): 24 hours before the reference
 * instant of a content with a time, at 9:00 of the day before for one without.
 */
export function dueNotificationAt(
  item: Pick<PlanItem, 'localDate' | 'localTime'>,
  timeZone: string,
): Date {
  if (item.localTime !== null)
    return new Date(
      referenceInstant(item.localDate, item.localTime, timeZone).getTime() - PLAN_NOTICE_BEFORE_MS,
    )
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.localDate))
    throw new DomainError('VALIDATION', 'not a date', { localDate: item.localDate })
  return zonedToInstant(previousDay(item.localDate), PLAN_NOTICE_TIME, timeZone).instant
}

/**
 * «Previsto dal piano il 20» (rule 3): the planned day when the post goes out on another one in
 * the agency's zone; null when it keeps the day, or has no date yet. It never blocks.
 */
export function plannedVsPost(
  item: Pick<PlanItem, 'localDate'>,
  post: Pick<PlanPostFacts, 'scheduledAt'>,
  timeZone: string,
): { plannedDate: string } | null {
  if (post.scheduledAt === null) return null
  const { localDate } = instantToZoned(post.scheduledAt, timeZone)
  return localDate === item.localDate ? null : { plannedDate: item.localDate }
}
