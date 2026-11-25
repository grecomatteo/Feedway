<script setup lang="ts">
import type { LocalDate } from '@app/domain'
import type { CalendarCardInfo } from '~/utils/calendar'

/**
 * A whole day of the calendar (plan 09 Task 3: «il giorno che si apre in un foglio»): a window on
 * a computer, a sheet from the bottom on a phone (DIALOG_UI). Its posts as the rows of «In uscita»
 * in Oggi: time, picture, text, client and state.
 */
const props = defineProps<{
  date: LocalDate | null
  today: LocalDate
  cards: CalendarCardInfo[]
  showClient: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const LONG = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const title = computed(() => {
  if (!props.date) return ''
  const long = LONG.format(new Date(`${props.date}T00:00:00Z`))
  const day = long.charAt(0).toUpperCase() + long.slice(1)
  return props.date === props.today ? `${t('calendar.today')}, ${long}` : day
})
const ui = { ...DIALOG_UI, content: `${DIALOG_UI.content} md:w-[560px]`, body: 'p-0 sm:p-0' }
const TYPE_ICON: Record<CalendarCardInfo['type'], string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="$t('calendar.posts', { n: cards.length }, cards.length)"
    :ui="ui"
    data-day-sheet
  >
    <template #body>
      <p v-if="cards.length === 0" class="px-5 pt-1 pb-5 text-(--app-text-muted)">
        {{ $t('calendar.emptyDay') }}
      </p>
      <ul v-else class="max-h-[60vh] overflow-y-auto pb-2">
        <li v-for="c in cards" :key="c.id" class="border-t border-(--app-border) first:border-t-0">
          <NuxtLink
            :to="c.to"
            class="grid min-h-row grid-cols-[3rem_2.5rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2 hover:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-focus)"
            :data-post="c.id"
            @click="open = false"
          >
            <span class="font-semibold tabular-nums">{{ c.time ?? '—' }}</span>
            <span
              class="flex size-10 items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline)"
            >
              <img v-if="c.thumb" :src="c.thumb" alt="" class="size-full object-cover" />
              <UIcon v-else :name="TYPE_ICON[c.type]" class="size-4" aria-hidden="true" />
            </span>
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ c.title }}</span>
              <span
                class="flex items-center justify-between gap-2.5 text-detail text-(--app-text-muted)"
              >
                <span class="truncate">{{ showClient ? c.client : '' }}</span>
                <StatusDot :tone="c.tone" :label="c.state" class="shrink-0" />
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </template>
  </UModal>
</template>
