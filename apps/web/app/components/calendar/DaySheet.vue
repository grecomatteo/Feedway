<script setup lang="ts">
import type { LocalDate } from '@app/domain'
import { CALENDAR_NEW_POST, dayCount, type CalendarCardInfo } from '~/utils/calendar'

/**
 * A whole day of the calendar (plan 09 Task 3: «il giorno che si apre in un foglio»): a window on
 * a computer, a sheet from the bottom on a phone (DIALOG_UI). Its posts as the rows of «In uscita»
 * in Oggi (CalendarRow).
 */
const props = defineProps<{
  date: LocalDate | null
  today: LocalDate
  cards: CalendarCardInfo[]
  showClient: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
// «Nuovo post» of this day (plan 09 Scelta 4), where the «+» of the day is
const newPostOn = inject(CALENDAR_NEW_POST, () => null)
const add = computed(() => (props.date ? newPostOn(props.date) : null))

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
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="dayCount(cards, $t).join(', ')"
    :ui="ui"
    data-day-sheet
  >
    <template #body>
      <p v-if="cards.length === 0" class="px-5 pt-1 pb-5 text-(--app-text-muted)">
        {{ $t('calendar.emptyDay') }}
      </p>
      <ul v-else class="max-h-[60vh] overflow-y-auto pb-2">
        <li v-for="c in cards" :key="c.id" class="border-t border-(--app-border) first:border-t-0">
          <CalendarRow :card="c" :show-client="showClient" @open="open = false" />
        </li>
      </ul>
    </template>
    <template v-if="add" #footer>
      <UButton
        :to="add"
        icon="i-lucide-plus"
        class="min-h-control max-md:w-full max-md:justify-center"
        data-day-add
        @click="open = false"
      >
        {{ $t('calendar.addHere') }}
      </UButton>
    </template>
  </UModal>
</template>
