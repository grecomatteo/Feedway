<script setup lang="ts">
import type { LocalDate } from '@app/domain'
import { CALENDAR_MOVING } from '~/composables/useCalendarMove'
import {
  CALENDAR_NEW_POST,
  cardLook,
  dayCount,
  shownInDay,
  type CalendarCardInfo,
} from '~/utils/calendar'

/**
 * The month (spec §11.4, screen 07): the 6×7 days of its grid from Monday, the days of the months
 * around on the sunken ground. A day shows up to four posts and «+N» for the rest; its number and
 * «+N» open the whole day in a sheet. On a phone a day is its number and a dot for each post, in
 * grey, red or amber only where something asks to be looked at, a ring for the plan, and the
 * whole day is the button («mese leggibile con i pallini»).
 */
const props = defineProps<{
  days: LocalDate[]
  /** `YYYY-MM`: the month shown, its days on the full ground */
  month: string
  today: LocalDate
  cards: Map<LocalDate, CalendarCardInfo[]>
  showClient: boolean
  /** the period's posts are still on their way: the days say nothing yet */
  loading: boolean
  /** on a phone, the day whose posts are listed under the month */
  selected?: LocalDate | null
}>()
const emit = defineEmits<{ openDay: [date: LocalDate] }>()
const { t } = useI18n()
// a day takes a post dragged onto it (plan 09 Task 4): today and the days ahead
const moving = inject(CALENDAR_MOVING, null)
const newPostOn = inject(CALENDAR_NEW_POST, () => null)

/** four on a computer: one less and «+N» when they do not fit (screen 07) */
const ROOM = 4
/** at most this many dots under a day's number on a phone */
const DOTS = 4

/** «lun» … «dom», from Monday 5 January 2026 on */
const SHORT = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  SHORT.format(new Date(Date.UTC(2026, 0, 5 + i))).replace('.', ''),
)
/** grey for every post, a colour only for what asks to be looked at (Matteo 25/11) */
const dotOf = (card: CalendarCardInfo) => {
  const look = cardLook(card)
  if (look === 'plan') return 'border border-(--app-text-muted)'
  if (look === 'alert')
    return card.tone === 'danger' ? 'bg-(--app-danger)' : 'bg-(--app-warning-dot)'
  return 'bg-(--app-neutral-dot)'
}
const LONG = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

const cells = computed(() =>
  props.days.map((date) => {
    const all = props.cards.get(date) ?? []
    const { shown, more } = shownInDay(all.length, ROOM)
    const long = LONG.format(new Date(`${date}T00:00:00Z`))
    return {
      date,
      number: Number(date.slice(8)),
      inMonth: date.startsWith(props.month),
      add: newPostOn(date),
      today: date === props.today,
      all,
      shown: all.slice(0, shown),
      more,
      long,
      // «giovedì 19 novembre, oggi, 4 post»
      label: [
        long,
        date === props.today ? t('calendar.today') : null,
        ...(props.loading ? [] : dayCount(all, t)),
      ]
        .filter(Boolean)
        .join(', '),
    }
  }),
)
</script>

<template>
  <div
    class="overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
    :aria-busy="loading || undefined"
    data-calendar-month
  >
    <div class="grid grid-cols-7" aria-hidden="true">
      <span
        v-for="d in WEEKDAYS"
        :key="d"
        class="px-2.5 py-2 text-caption font-medium text-(--app-text-muted) max-md:px-0 max-md:text-center"
        >{{ d }}</span
      >
    </div>
    <ol class="grid grid-cols-7" :aria-label="$t('calendar.view.month')">
      <li
        v-for="c in cells"
        :key="c.date"
        class="group/day relative flex min-w-0 flex-col gap-[3px] border-t border-s border-(--app-border) p-1.5 nth-[7n+1]:border-s-0 md:min-h-[7.5rem] max-md:min-h-14 max-md:items-center max-md:px-0 max-md:pt-1 max-md:pb-2"
        :class="[
          c.inMonth ? '' : 'bg-(--app-surface-sunken)',
          c.date === selected ? 'max-md:bg-(--app-nav-hover)' : '',
          moving?.over.value === c.date ? 'shadow-[inset_0_0_0_2px_var(--app-text)]' : '',
        ]"
        :data-day="c.date"
        :data-today="c.today || undefined"
        :data-drop-over="moving?.over.value === c.date || undefined"
        @dragover="moving?.dragOver($event, c.date)"
        @dragleave="moving?.leave($event, c.date)"
        @drop="moving?.drop($event, c.date)"
      >
        <!-- the number opens the whole day; on a phone the whole day is the button. Today's
             orange is a marker, as on the canvas (07), not an action: «data-accent» -->
        <button
          type="button"
          :aria-label="c.label"
          class="self-start rounded-[5px] px-1.5 text-caption leading-5 font-medium tabular-nums hover:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:outline-(--app-focus) max-md:static max-md:self-center max-md:after:absolute max-md:after:inset-0"
          :class="
            c.today
              ? 'bg-(--app-brand) font-semibold text-(--app-on-brand) hover:bg-(--app-brand-hover)'
              : 'text-(--app-text-muted)'
          "
          :data-accent="c.today || undefined"
          data-day-open
          @click="emit('openDay', c.date)"
        >
          {{ c.number }}
        </button>
        <!-- «+»: on hover and focus, always on a touch screen; on a phone under the month -->
        <NuxtLink
          v-if="c.add"
          :to="c.add"
          class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-[5px] text-(--app-text-muted) opacity-0 group-hover/day:opacity-100 hover:bg-(--app-nav-hover) hover:text-(--app-text) focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-(--app-focus) pointer-coarse:opacity-100 max-md:hidden"
          :aria-label="$t('calendar.add', { day: c.long })"
          data-day-add
        >
          <UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />
        </NuxtLink>
        <template v-if="!loading">
          <ul class="contents max-md:hidden">
            <li v-for="card in c.shown" :key="card.id" class="@container flex min-w-0 flex-col">
              <CalendarCard :card="card" size="chip" :show-client="showClient" :today="c.today" />
            </li>
          </ul>
          <button
            v-if="c.more > 0"
            type="button"
            class="self-start rounded-[5px] px-1.5 text-caption leading-[22px] text-(--app-text-muted) hover:bg-(--app-nav-hover) hover:text-(--app-text) focus-visible:outline-2 focus-visible:outline-(--app-focus) max-md:hidden"
            :aria-label="$t('calendar.more', { n: c.more, day: c.label }, c.more)"
            data-day-more
            @click="emit('openDay', c.date)"
          >
            +{{ c.more }}
          </button>
          <span
            v-if="c.all.length > 0"
            class="flex max-w-full flex-wrap justify-center gap-[3px] px-1 md:hidden"
            aria-hidden="true"
            data-day-dots
          >
            <i
              v-for="card in c.all.slice(0, DOTS)"
              :key="card.id"
              class="block size-[5px] rounded-full"
              :class="dotOf(card)"
            />
          </span>
        </template>
      </li>
    </ol>
  </div>
</template>
