<script setup lang="ts">
import { parseTime, timeSteps } from '~/utils/day-time'

/**
 * An hour chosen without the browser's field (plan R7, screen 08): «18:00» in a field that opens
 * the hours of the day every quarter, with a box on top to write any other («18:07», «1807»).
 * Always on a 24-hour clock.
 */
const props = defineProps<{
  /** what the field is, for a screen reader («Ora») */
  label: string
  disabled?: boolean
}>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()

const open = ref(false)
const typed = ref('')
const wrong = ref(false)
const STEPS = timeSteps(15)
/** the hours of the list, with the chosen one in its place when it is not a quarter */
const list = computed(() =>
  model.value && !STEPS.includes(model.value) ? [...STEPS, model.value].sort() : STEPS,
)
const shown = computed(() => (model.value ? formatTime(model.value) : '—'))

const box = ref<HTMLElement | null>(null)
watch(open, async (now) => {
  typed.value = ''
  wrong.value = false
  if (!now) return
  await nextTick()
  // the chosen hour, or the nearest quarter, at the top of the list
  const near = model.value
    ? (list.value.find((x) => x >= model.value) ?? list.value.at(-1))
    : '09:00'
  box.value?.querySelector<HTMLElement>(`[data-time="${near ?? ''}"]`)?.scrollIntoView({
    block: 'center',
  })
})
function choose(time: string) {
  model.value = time
  open.value = false
}
function write() {
  const time = parseTime(typed.value)
  if (!time) {
    wrong.value = true
    return
  }
  choose(time)
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'bottom', align: 'start', sideOffset: 4 }"
    :ui="{
      content:
        'w-[11rem] rounded-card border border-(--app-border) bg-(--app-surface) p-1.5 shadow-(--app-shadow-2) ring-0',
    }"
  >
    <button
      type="button"
      :disabled="disabled"
      class="flex h-control w-28 items-center gap-2 rounded-control border border-(--app-field-border) bg-(--app-surface) px-2.5 text-start tabular-nums disabled:cursor-not-allowed disabled:opacity-60"
      :aria-label="`${label}: ${shown}`"
      data-time-field
    >
      <UIcon
        name="i-lucide-clock"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">{{ shown }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
    </button>
    <template #content>
      <div class="flex flex-col gap-1" data-time-picker>
        <form novalidate @submit.prevent="write">
          <label class="sr-only" for="time-typed">{{ t('posts.when.typeTime') }}</label>
          <input
            id="time-typed"
            v-model="typed"
            inputmode="numeric"
            autocomplete="off"
            :placeholder="t('posts.when.typeTimePlaceholder')"
            :aria-invalid="wrong || undefined"
            :aria-describedby="wrong ? 'time-wrong' : undefined"
            class="h-control w-full rounded-control border border-(--app-field-border) bg-(--app-surface) px-2.5 tabular-nums outline-none focus-visible:border-(--app-text)"
            @input="wrong = false"
          />
          <p
            v-if="wrong"
            id="time-wrong"
            role="alert"
            class="px-1 pt-1 text-caption text-(--app-danger)"
          >
            {{ t('posts.when.wrongTime') }}
          </p>
        </form>
        <ul ref="box" class="max-h-56 overflow-y-auto" :aria-label="label">
          <li v-for="x in list" :key="x">
            <button
              type="button"
              :aria-pressed="x === model"
              :data-time="x"
              class="flex h-9 w-full items-center rounded-control px-2.5 tabular-nums max-md:h-11"
              :class="
                x === model
                  ? 'bg-(--app-text) font-semibold text-(--app-surface)'
                  : 'hover:bg-(--app-surface-sunken)'
              "
              @click="choose(x)"
            >
              {{ formatTime(x) }}
            </button>
          </li>
        </ul>
      </div>
    </template>
  </UPopover>
</template>
