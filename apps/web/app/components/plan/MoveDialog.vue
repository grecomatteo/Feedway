<script setup lang="ts">
import type { PlanItem } from '~/utils/plan'

/** «Sposta…» (spec §11.12): the other way to move a content, for the keyboard and the phone. */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ item: PlanItem | null; today: string }>()
const emit = defineEmits<{ move: [item: PlanItem, day: string] }>()

const day = ref('')
watch(open, (now) => {
  if (now) day.value = props.item?.localDate ?? props.today
})
function submit() {
  if (props.item && day.value && day.value !== props.item.localDate)
    emit('move', props.item, day.value)
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="item ? $t('plan.move.title', { title: item.title }) : ''"
    :close="false"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.24)]',
      content:
        'w-[360px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
      header: 'min-h-0 border-0 px-5 pt-5 pb-1',
      title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em] break-words',
      body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
      footer: 'justify-end gap-2 px-5 py-3.5 sm:px-5 max-md:pb-5',
    }"
    data-plan-move
  >
    <template #body>
      <form id="plan-move" class="grid gap-1.5" novalidate @submit.prevent="submit">
        <span class="font-medium" aria-hidden="true">{{ $t('plan.move.to') }}</span>
        <DayField v-model="day" :label="$t('plan.move.to')" :today="today" />
      </form>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        class="max-md:flex-1 max-md:justify-center"
        @click="open = false"
      >
        {{ $t('plan.form.cancel') }}
      </UButton>
      <UButton type="submit" form="plan-move" class="max-md:flex-1 max-md:justify-center">
        {{ $t('plan.move.submit') }}
      </UButton>
    </template>
  </UModal>
</template>
