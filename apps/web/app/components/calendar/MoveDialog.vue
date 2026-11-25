<script setup lang="ts">
import type { CalendarPostRow } from '~/composables/useCalendar'

/**
 * «Sposta…» of a post (spec §11.4, plan 09 P7): the other way to move it, for the keyboard and
 * the phone, and the only one to change its time (the week has no grid of hours, D-123.25). Day
 * and time are the agency's, as the calendar shows them. The window of «Sposta…» of the plan.
 */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ post: CalendarPostRow | null; today: string }>()
const emit = defineEmits<{
  move: [post: CalendarPostRow, to: { localDate: string; localTime: string }]
}>()
const { t } = useI18n()

const day = ref('')
const time = ref('')
watch(open, (now) => {
  if (!now) return
  day.value = props.post?.localDate ?? props.today
  time.value = props.post?.localTime ?? ''
})
const title = computed(() =>
  props.post ? t('calendar.move.title', { title: postTitle(props.post, t) }) : '',
)
function submit() {
  const post = props.post
  if (post && day.value && time.value)
    emit('move', post, { localDate: day.value, localTime: time.value })
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :close="false"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.24)]',
      content:
        'w-[400px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
      header: 'min-h-0 border-0 px-5 pt-5 pb-1',
      title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em] break-words',
      body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
      footer: 'justify-end gap-2 px-5 py-3.5 sm:px-5 max-md:pb-5',
    }"
    data-calendar-move
  >
    <template #body>
      <form id="calendar-move" class="flex flex-wrap gap-3" novalidate @submit.prevent="submit">
        <div class="grid gap-1.5">
          <span class="font-medium" aria-hidden="true">{{ $t('calendar.move.day') }}</span>
          <DayField v-model="day" :label="$t('calendar.move.day')" :today="today" />
        </div>
        <div class="grid gap-1.5">
          <span class="font-medium" aria-hidden="true">{{ $t('calendar.move.time') }}</span>
          <TimeField v-model="time" :label="$t('calendar.move.time')" />
        </div>
      </form>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        class="max-md:flex-1 max-md:justify-center"
        @click="open = false"
      >
        {{ $t('calendar.move.cancel') }}
      </UButton>
      <UButton
        type="submit"
        form="calendar-move"
        class="max-md:flex-1 max-md:justify-center"
        data-calendar-move-submit
      >
        {{ $t('calendar.move.submit') }}
      </UButton>
    </template>
  </UModal>
</template>
