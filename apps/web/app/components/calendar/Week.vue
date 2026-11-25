<script setup lang="ts">
import type { LocalDate } from '@app/domain'
import { CALENDAR_MOVING } from '~/composables/useCalendarMove'
import { CALENDAR_NEW_POST, dayCount, type CalendarCardInfo } from '~/utils/calendar'

/**
 * The week (spec §11.4: «lo zoom di dettaglio con miniature grandi»): seven columns from Monday,
 * each day's posts by time with the picture large. A column per day and not a grid of hours: two
 * posts at 18:00 and 18:30 would cover each other, and the time is on every card. Narrower than
 * 56 rem (a phone, a small window) the days go one under the other, two or four cards a row.
 */
const props = defineProps<{
  days: LocalDate[]
  today: LocalDate
  cards: Map<LocalDate, CalendarCardInfo[]>
  showClient: boolean
  loading: boolean
}>()
const emit = defineEmits<{ openDay: [date: LocalDate] }>()
const { t } = useI18n()
// a day takes a post dragged onto it (plan 09 Task 4): today and the days ahead
const moving = inject(CALENDAR_MOVING, null)
const newPostOn = inject(CALENDAR_NEW_POST, () => null)

const SHORT = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })
const LONG = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const columns = computed(() =>
  props.days.map((date) => {
    const day = new Date(`${date}T00:00:00Z`)
    const all = props.cards.get(date) ?? []
    return {
      date,
      weekday: date === props.today ? t('calendar.today') : SHORT.format(day).replace('.', ''),
      number: day.getUTCDate(),
      today: date === props.today,
      past: date < props.today,
      add: newPostOn(date),
      long: LONG.format(day),
      all,
      label: [LONG.format(day), ...(props.loading ? [] : dayCount(all, t))]
        .filter(Boolean)
        .join(', '),
    }
  }),
)
</script>

<template>
  <div
    class="@container overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
    :aria-busy="loading || undefined"
    data-calendar-week
  >
    <ol class="grid @min-[56rem]:grid-cols-7" :aria-label="$t('calendar.view.week')">
      <li
        v-for="c in columns"
        :key="c.date"
        class="flex min-w-0 flex-col border-t border-(--app-border) first:border-t-0 @min-[56rem]:border-t-0 @min-[56rem]:border-s @min-[56rem]:first:border-s-0"
        :class="moving?.over.value === c.date ? 'shadow-[inset_0_0_0_2px_var(--app-text)]' : ''"
        :data-day="c.date"
        :data-today="c.today || undefined"
        :data-drop-over="moving?.over.value === c.date || undefined"
        @dragover="moving?.dragOver($event, c.date)"
        @dragleave="moving?.leave($event, c.date)"
        @drop="moving?.drop($event, c.date)"
      >
        <div class="group/day relative flex border-b border-(--app-border)">
          <button
            type="button"
            :aria-label="c.label"
            class="flex flex-1 items-baseline gap-1.5 px-3 pt-2.5 pb-2 text-start hover:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-focus)"
            data-day-open
            @click="emit('openDay', c.date)"
          >
            <span class="text-caption text-(--app-text-muted)">{{ c.weekday }}</span>
            <span
              class="text-[15px] leading-5 font-semibold tabular-nums"
              :class="c.past ? 'text-(--app-text-muted)' : ''"
              >{{ c.number }}</span
            >
            <span
              v-if="c.today"
              class="absolute inset-x-0 -bottom-px h-0.5 bg-(--app-brand)"
              aria-hidden="true"
              data-accent
            />
          </button>
          <!-- «+»: on hover and focus, always on a touch screen -->
          <NuxtLink
            v-if="c.add"
            :to="c.add"
            class="me-1.5 grid size-8 shrink-0 place-self-center place-items-center rounded-[5px] text-(--app-text-muted) opacity-0 group-hover/day:opacity-100 hover:bg-(--app-nav-hover) hover:text-(--app-text) focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-(--app-focus) pointer-coarse:size-11 pointer-coarse:opacity-100"
            :aria-label="$t('calendar.add', { day: c.long })"
            data-day-add
          >
            <UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />
          </NuxtLink>
        </div>
        <div v-if="loading" class="flex flex-col gap-2 p-2" aria-hidden="true">
          <USkeleton class="aspect-[4/5] w-full rounded-thumb" />
        </div>
        <ul
          v-else-if="c.all.length > 0"
          class="grid grid-cols-2 gap-2 p-2 @min-[36rem]:grid-cols-4 @min-[56rem]:grid-cols-1"
        >
          <li v-for="card in c.all" :key="card.id" class="flex min-w-0 flex-col">
            <CalendarCard :card="card" size="tile" :show-client="showClient" :today="c.today" />
          </li>
        </ul>
        <p v-else class="px-3 py-3 text-caption text-(--app-text-muted)">
          {{ $t('calendar.free') }}
        </p>
      </li>
    </ol>
  </div>
</template>
