<script setup lang="ts">
import { addDays, addMonths, monthGrid, monthOf } from '~/utils/day-time'

/**
 * A day chosen without the browser's field (plan R7, screen 08): «venerdì 20 novembre» in a field
 * that opens a month. The arrows move by a day and a week, Page Up and Page Down by a month,
 * Home and End to the week's ends; Enter or a click chooses. Days in the past can be chosen: the
 * checks say why they do not go out (P1).
 */
const props = defineProps<{
  /** what the field is, for a screen reader («Giorno») */
  label: string
  disabled?: boolean
  /** «oggi» in the post's zone, as a wall date */
  today: string
}>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()

const open = ref(false)
/** the day with the focus in the month shown */
const cursor = ref(model.value || props.today)
watch(open, (now) => {
  if (now) cursor.value = model.value || props.today
})
const weeks = computed(() => monthGrid(cursor.value))
const month = computed(() => {
  const [y, m] = monthOf(cursor.value).split('-').map(Number)
  const name = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, 1)),
  )
  return `${name} ${String(y)}`
})
const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const shown = computed(() => (model.value ? formatDay(model.value) : t('posts.when.noDay')))

const grid = ref<HTMLElement | null>(null)
async function focusCursor() {
  await nextTick()
  grid.value?.querySelector<HTMLElement>(`[data-day="${cursor.value}"]`)?.focus()
}
function choose(date: string) {
  model.value = date
  open.value = false
}
function key(event: KeyboardEvent) {
  const moves: Record<string, () => string> = {
    ArrowLeft: () => addDays(cursor.value, -1),
    ArrowRight: () => addDays(cursor.value, 1),
    ArrowUp: () => addDays(cursor.value, -7),
    ArrowDown: () => addDays(cursor.value, 7),
    PageUp: () => addMonths(cursor.value, -1),
    PageDown: () => addMonths(cursor.value, 1),
    Home: () => {
      const d = new Date(`${cursor.value}T00:00:00Z`)
      return addDays(cursor.value, -((d.getUTCDay() + 6) % 7))
    },
    End: () => {
      const d = new Date(`${cursor.value}T00:00:00Z`)
      return addDays(cursor.value, 6 - ((d.getUTCDay() + 6) % 7))
    },
  }
  const to = moves[event.key]
  if (!to) return
  event.preventDefault()
  cursor.value = to()
  void focusCursor()
}
function month_(by: -1 | 1) {
  cursor.value = addMonths(cursor.value, by)
}
const dayLabel = (date: string) => formatDay(date)
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{
      side: 'bottom',
      align: 'start',
      sideOffset: 4,
      onOpenAutoFocus: (e: Event) => {
        e.preventDefault()
        void focusCursor()
      },
    }"
    :ui="{
      content:
        'w-[18.5rem] rounded-card border border-(--app-border) bg-(--app-surface) p-3 shadow-(--app-shadow-2) ring-0',
    }"
  >
    <button
      type="button"
      :disabled="disabled"
      class="flex h-control w-[13.75rem] max-w-full items-center gap-2 rounded-control border border-(--app-field-border) bg-(--app-surface) px-2.5 text-start disabled:cursor-not-allowed disabled:opacity-60"
      :aria-label="`${label}: ${shown}`"
      data-day-field
    >
      <UIcon
        name="i-lucide-calendar"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 truncate" :class="model ? '' : 'text-(--app-text-muted)'">{{
        shown
      }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
    </button>
    <template #content>
      <div class="flex flex-col gap-2" data-day-picker>
        <div class="flex items-center gap-1">
          <p class="flex-1 ps-1 font-semibold first-letter:uppercase" aria-live="polite">
            {{ month }}
          </p>
          <UButton
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-chevron-left"
            :aria-label="$t('posts.when.prevMonth')"
            @click="month_(-1)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-chevron-right"
            :aria-label="$t('posts.when.nextMonth')"
            @click="month_(1)"
          />
        </div>
        <table ref="grid" role="grid" :aria-label="month" class="w-full table-fixed" @keydown="key">
          <thead>
            <tr>
              <th
                v-for="d in WEEKDAYS"
                :key="d"
                scope="col"
                class="pb-1 text-caption font-medium text-(--app-text-muted)"
              >
                {{ d }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(w, i) in weeks" :key="i">
              <td v-for="d in w" :key="d.date" class="p-0.5 text-center">
                <button
                  type="button"
                  :tabindex="d.date === cursor ? 0 : -1"
                  :aria-label="dayLabel(d.date)"
                  :aria-pressed="d.date === model"
                  :aria-current="d.date === today ? 'date' : undefined"
                  :data-day="d.date"
                  class="h-9 w-full rounded-control tabular-nums transition-colors max-md:h-10"
                  :class="[
                    d.date === model
                      ? 'bg-(--app-text) font-semibold text-(--app-surface)'
                      : 'hover:bg-(--app-surface-sunken)',
                    d.inMonth || d.date === model ? '' : 'text-(--app-text-muted)',
                    d.date === today && d.date !== model
                      ? 'font-semibold underline underline-offset-4'
                      : '',
                  ]"
                  @click="choose(d.date)"
                  @focus="cursor = d.date"
                >
                  {{ Number(d.date.slice(8)) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </UPopover>
</template>
