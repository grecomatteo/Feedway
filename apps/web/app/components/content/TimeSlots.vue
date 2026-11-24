<script setup lang="ts">
import type { TimeSlotDto } from '@app/contracts'

/**
 * «Fasce orarie» (spec §11.6, plan 09 Task 9, Scelta 6): the client's usual times, one row per
 * weekday with its times as chips. Every change saves the whole list at once, as the usual time
 * above does: a chip's «×» takes it off, «Aggiungi» puts a quarter of an hour in, «Copia il
 * lunedì su mar–ven» gives Tuesday to Friday Monday's times. «Prossima fascia libera» in the
 * editor proposes the first one without a post. Who does not manage the client reads them.
 */
const props = defineProps<{ base: string; manages: boolean }>()
const { t } = useI18n()
const { call, failure } = useApi()

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const
const slots = ref<TimeSlotDto[] | null>(null)
const failed = ref(false)
const saving = ref(false)
const state = ref<'idle' | 'saved'>('idle')
const problem = ref<string | null>(null)

async function load() {
  if (!props.base) return
  failed.value = false
  try {
    slots.value = (await call<{ items: TimeSlotDto[] }>('GET', `${props.base}/time-slots`)).items
  } catch {
    failed.value = true
  }
}
watch(
  () => props.base,
  () => void load(),
  { immediate: true },
)

const timesOf = (day: number) =>
  (slots.value ?? []).filter((s) => s.weekday === day).map((s) => s.localTime)

async function save(next: TimeSlotDto[]) {
  const before = slots.value
  slots.value = next
  saving.value = true
  problem.value = null
  state.value = 'idle'
  try {
    slots.value = (
      await call<{ items: TimeSlotDto[] }>('PUT', `${props.base}/time-slots`, { slots: next })
    ).items
    state.value = 'saved'
  } catch (e) {
    problem.value = failure(e).message
    slots.value = before
  } finally {
    saving.value = false
  }
}

const add = (weekday: number, localTime: string) => {
  if (timesOf(weekday).includes(localTime)) return
  void save([...(slots.value ?? []), { weekday, localTime }])
}
const remove = (weekday: number, localTime: string) =>
  void save(
    (slots.value ?? []).filter((s) => !(s.weekday === weekday && s.localTime === localTime)),
  )
function copyMonday() {
  const monday = timesOf(1)
  void save([
    ...(slots.value ?? []).filter((s) => s.weekday === 1 || s.weekday > 5),
    ...[2, 3, 4, 5].flatMap((weekday) => monday.map((localTime) => ({ weekday, localTime }))),
  ])
}
const mondayCopied = computed(() => {
  const monday = timesOf(1).join(',')
  return [2, 3, 4, 5].every((d) => timesOf(d).join(',') === monday)
})

// every quarter of an hour, as the usual time; the times already on the day are left out
const QUARTERS = Array.from(
  { length: 96 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
)
const choicesFor = (day: number) => {
  const taken = new Set(timesOf(day))
  return QUARTERS.filter((q) => !taken.has(q)).map((q) => ({ value: q, label: formatTime(q) }))
}
// the select always shows its placeholder: a pick adds, and a new select takes its place
const picks = ref(0)
const root = ref<HTMLElement | null>(null)
async function pick(day: number, value: string) {
  picks.value++
  add(day, value)
  // the keyboard stays on the day's «Aggiungi»
  await nextTick()
  root.value
    ?.querySelector<HTMLElement>(`[data-slot-day="${String(day)}"] [data-add-slot]`)
    ?.focus()
}

const dayName = (day: number) => t(`contentSettings.slots.days.${String(day)}`)
const count = computed(() => (slots.value ? slots.value.length : null))
</script>

<template>
  <section ref="root" :aria-label="$t('contentSettings.slots.title')" data-content-slots>
    <SectionHead :title="$t('contentSettings.slots.title')" :count="count" :level="3">
      <UButton
        v-if="manages && slots"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-lucide-copy"
        :disabled="saving || timesOf(1).length === 0 || mondayCopied"
        data-copy-monday
        @click="copyMonday"
      >
        {{ $t('contentSettings.slots.copyMonday') }}
      </UButton>
    </SectionHead>
    <p class="mb-3 text-detail text-(--app-text-muted)">{{ $t('contentSettings.slots.text') }}</p>
    <LoadFailed v-if="failed" :text="$t('contentSettings.slots.loadError')" @retry="load()" />
    <ListSkeleton v-else-if="!slots" :rows="3" :action="false" />
    <div v-else class="rounded-card border border-(--app-border) bg-(--app-surface)">
      <SettingsRow v-for="day in DAYS" :key="day" :label="dayName(day)" :data-slot-day="day">
        <ul
          v-if="timesOf(day).length > 0"
          class="contents"
          :aria-label="$t('contentSettings.slots.timesOf', { day: dayName(day) })"
        >
          <li
            v-for="time in timesOf(day)"
            :key="time"
            class="inline-flex h-7 items-center gap-1 rounded-control border border-(--app-border-strong) bg-(--app-surface) ps-2 pe-1 text-[0.8125rem] tabular-nums"
            :class="manages ? '' : 'pe-2'"
            data-time-slot
          >
            {{ formatTime(time) }}
            <button
              v-if="manages"
              type="button"
              class="inline-flex size-5 items-center justify-center rounded-[4px] [@media(hover:none)]:size-7 text-(--app-text-muted) hover:bg-(--app-nav-hover) hover:text-(--app-text) disabled:opacity-50"
              :aria-label="
                $t('contentSettings.slots.remove', { time: formatTime(time), day: dayName(day) })
              "
              :disabled="saving"
              data-remove-slot
              @click="remove(day, time)"
            >
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </li>
        </ul>
        <span v-else-if="!manages" class="text-(--app-text-muted)">—</span>
        <USelect
          v-if="manages"
          :key="`${String(day)}-${String(picks)}`"
          :model-value="undefined"
          :items="choicesFor(day)"
          :placeholder="$t('contentSettings.slots.add')"
          icon="i-lucide-plus"
          size="sm"
          variant="ghost"
          class="w-32"
          :disabled="saving"
          :aria-label="$t('contentSettings.slots.addTo', { day: dayName(day) })"
          data-add-slot
          @update:model-value="(v: string) => void pick(day, v)"
        />
      </SettingsRow>
    </div>
    <p
      v-if="state === 'saved' && !saving"
      role="status"
      class="mt-2 text-detail text-(--app-success)"
    >
      {{ $t('contentSettings.savedShort') }}
    </p>
    <p v-if="problem" role="alert" class="mt-2 text-sm text-(--app-danger)">{{ problem }}</p>
  </section>
</template>
