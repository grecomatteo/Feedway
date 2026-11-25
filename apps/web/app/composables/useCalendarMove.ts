import type { InjectionKey } from 'vue'
import type { FetchError } from 'ofetch'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { PostResponse } from '@app/contracts'
import type { LocalDate } from '@app/domain'
import type { CalendarPostRow } from '~/composables/useCalendar'
import { movedWhen } from '~/utils/calendar-move'
import type { CalendarCardInfo } from '~/utils/calendar'
import { ruleMessage } from '~/utils/rule-message'

type Wall = { localDate: string; localTime: string }

/**
 * What the days and the cards of the calendar need to move a post (plan 09 Task 4), given by
 * the calendar to its month, week, list and day: drag a card onto a day, or «Sposta…» from its
 * menu. Absent (null) where nothing moves.
 */
export interface CalendarMoving {
  /** today or a day ahead: a card is dropped only there */
  canDrop: (date: LocalDate) => boolean
  /** the card being dragged, and the day under it */
  lifted: Ref<string | null>
  over: Ref<LocalDate | null>
  lift: (event: DragEvent, card: CalendarCardInfo) => void
  settle: () => void
  dragOver: (event: DragEvent, date: LocalDate) => void
  leave: (event: DragEvent, date: LocalDate) => void
  drop: (event: DragEvent, date: LocalDate) => void
  /** the card's menu: «Sposta…» where it moves; empty for the others */
  actionsOf: (card: CalendarCardInfo) => DropdownMenuItem[][]
}
export const CALENDAR_MOVING: InjectionKey<CalendarMoving | null> = Symbol('calendar-moving')

interface ErrorReport {
  error?: { code?: string; reason?: string; report?: { outcomes?: unknown[] } }
}

/**
 * Moving a post of the calendar (spec §11.4, plan 09 P7): the post goes to its new day at once
 * and back if the server says no; the save is `PATCH` of the post with the version read (409
 * when another person changed it) and, for a scheduled one, the checks of «Programma» (422 with
 * the report). «Annulla» for five seconds puts day and time back, with the version of the move.
 */
export function useCalendarMove(opts: {
  posts: Ref<CalendarPostRow[]>
  /** the agency's zone, the one of the calendar's days (D-58) */
  timeZone: Ref<string>
  today: Ref<LocalDate>
  patch: (id: string, change: Partial<CalendarPostRow>) => void
  /** the days shown read again in place, with the list's pages */
  reload: () => Promise<void>
}) {
  const org = useOrganization()
  const { call, failure } = useApi()
  const { t } = useI18n()

  const toast = reactive({ open: false, message: '', action: '' })
  let undo: (() => Promise<void>) | null = null
  async function tell(message: string, back: (() => Promise<void>) | null) {
    undo = back
    // closed first, so a second move starts its five seconds again
    toast.open = false
    await nextTick()
    Object.assign(toast, { open: true, message, action: back ? t('calendar.move.undo') : '' })
  }
  async function runUndo() {
    const back = undo
    undo = null
    if (back) await back()
  }

  /** why the last move did not happen, said above the calendar */
  const problem = ref<string | null>(null)
  function why(e: unknown): string {
    const f = failure(e)
    const body = (e as FetchError<ErrorReport> | undefined)?.data?.error
    // only a version too old is "another person": a 409 also says a post already publishing or
    // a client archived, and its own message says which
    if (body?.reason === 'post_version_conflict') return t('calendar.move.changed')
    if (body?.reason === 'post_not_schedulable') {
      const block = (body.report?.outcomes ?? []).find(
        (o): o is Parameters<typeof ruleMessage>[0] =>
          typeof o === 'object' && o !== null && (o as { level?: unknown }).level === 'block',
      )
      return block ? ruleMessage(block, t).title : t('posts.actions.notSchedulable')
    }
    return f.message
  }

  /** the posts whose move is on its way: not moved again until the server answers */
  const pending = ref(new Set<string>())
  async function move(post: CalendarPostRow, to: Wall, undoable = true) {
    if (pending.value.has(post.id) || post.localDate === null || post.localTime === null) return
    if (post.localDate === to.localDate && post.localTime === to.localTime) return
    problem.value = null
    const before: Wall = { localDate: post.localDate, localTime: post.localTime }
    pending.value = new Set([...pending.value, post.id])
    opts.patch(post.id, to)
    try {
      const saved = await call<PostResponse>(
        'PATCH',
        org.api(
          `/workspaces/${encodeURIComponent(post.workspaceId)}/posts/${encodeURIComponent(post.id)}`,
        ),
        { version: post.version, when: movedWhen(post, to, opts.timeZone.value) },
      )
      opts.patch(post.id, { version: saved.version })
      void tell(
        t('calendar.move.done', { when: formatWallSentence(to.localDate, to.localTime) }),
        undoable
          ? async () => {
              // the version of now: the read after the move may have brought a newer one; a
              // post moved out of the days read is no longer there, and goes back with the
              // version of the move
              const current = opts.posts.value.find((p) => p.id === post.id) ?? {
                ...post,
                ...to,
                version: saved.version,
              }
              await move(current, before, false)
            }
          : null,
      )
    } catch (e) {
      opts.patch(post.id, before)
      problem.value = t('calendar.move.failed', { title: postTitle(post, t), reason: why(e) })
    } finally {
      pending.value = new Set([...pending.value].filter((id) => id !== post.id))
      // the state, the version and the order of the day as the server has them now
      void opts.reload()
    }
  }

  // ---- «Sposta…»: the other way, for the keyboard and the phone
  const dialog = reactive({ open: false, post: null as CalendarPostRow | null })
  const postOf = (card: CalendarCardInfo) =>
    card.kind === 'post' ? opts.posts.value.find((p) => p.id === card.id) : undefined
  function actionsOf(card: CalendarCardInfo): DropdownMenuItem[][] {
    if (!card.movable) return []
    return [
      [
        {
          label: t('calendar.move.action'),
          icon: 'i-lucide-calendar-clock',
          onSelect: () => {
            const post = postOf(card)
            if (post) Object.assign(dialog, { open: true, post })
          },
        },
      ],
    ]
  }

  // ---- dragging, on a computer
  const lifted = ref<string | null>(null)
  const over = ref<LocalDate | null>(null)
  const canDrop = (date: LocalDate) => date >= opts.today.value
  function lift(event: DragEvent, card: CalendarCardInfo) {
    lifted.value = card.id
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', card.id)
    }
  }
  function settle() {
    lifted.value = null
    over.value = null
  }
  function dragOver(event: DragEvent, date: LocalDate) {
    if (!lifted.value || !canDrop(date)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    over.value = date
  }
  function leave(event: DragEvent, date: LocalDate) {
    const to = event.relatedTarget
    if (over.value === date && !(to instanceof Node && (event.currentTarget as Node).contains(to)))
      over.value = null
  }
  function drop(event: DragEvent, date: LocalDate) {
    event.preventDefault()
    const post = opts.posts.value.find((p) => p.id === lifted.value)
    settle()
    if (post?.localTime && canDrop(date) && post.localDate !== date)
      void move(post, { localDate: date, localTime: post.localTime })
  }

  const moving: CalendarMoving = {
    canDrop,
    lifted,
    over,
    lift,
    settle,
    dragOver,
    leave,
    drop,
    actionsOf,
  }
  return { moving, move, pending, problem, toast, runUndo, dialog }
}
