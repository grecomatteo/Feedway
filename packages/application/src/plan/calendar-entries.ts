import { planItemState, referenceInstant, type PlanItemType } from '@app/domain'
import type { CalendarEntry, CalendarEntrySource } from '../module-definition.js'
import { getStatuses } from '../posts/index.js'

// The plan in the main calendar (spec §11.12, plan 09 Task 6): a dashed card for each content
// still to prepare. A prepared content gives no card, only the «dal piano» mark on its post,
// looked up by post. The calendar shows an entry to whoever sees the client, so `data` carries
// the fields below and nothing else: never the note (Scelta 11, rule 6).

/** What a plan card says besides title, day and time: declared field by field. */
export interface PlanEntryData {
  type: PlanItemType
  /** 'to_prepare' | 'due_soon' | 'late', at the time of the read; the panel moves it on */
  state: string
  /** the instant the state counts from */
  dueAt: string
  /** the cancelled post it had, if any; null otherwise */
  postId: string | null
}

export const planCalendarEntries: CalendarEntrySource = {
  id: 'plan',
  async entries(tx, query) {
    const items = await tx.plan.listInRange(query.organizationId, query.workspaceIds, query)
    const statuses = await getStatuses(
      tx,
      query.organizationId,
      items.flatMap((i) => (i.postId ? [i.postId] : [])),
    )
    const out: CalendarEntry[] = []
    for (const item of items) {
      const status = item.postId ? statuses.get(item.postId) : undefined
      const post = status === undefined ? null : { status, scheduledAt: null }
      const state = planItemState(item, post, query.now, query.timeZone)
      if (state === 'prepared') continue
      const data: PlanEntryData = {
        type: item.type,
        state,
        dueAt: referenceInstant(item.localDate, item.localTime, query.timeZone).toISOString(),
        postId: item.postId,
      }
      out.push({
        source: 'plan',
        id: item.id,
        workspaceId: item.workspaceId,
        localDate: item.localDate,
        localTime: item.localTime,
        title: item.title,
        kind: 'plan',
        data: { ...data },
      })
    }
    return out
  },
  async markedPostIds(tx, { organizationId, postIds }) {
    const items = await tx.plan.findByPostIds(organizationId, postIds)
    return new Set(items.flatMap((i) => (i.postId ? [i.postId] : [])))
  },
}
