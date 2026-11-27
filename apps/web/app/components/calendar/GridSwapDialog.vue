<script setup lang="ts">
import type { GridSwapPost } from '~/utils/calendar-grid'

/**
 * «Scambia con…» of the grid (spec §11.5, plan 09 Scelta 10): the confirmation of a swap, and the
 * way for the keyboard and the phone. Opened by a drop, the other post is already chosen; from
 * the menu of a post, the person picks it among the other scheduled ones the grid may move.
 */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  post: GridSwapPost | null
  /** the one chosen by a drop; null: to pick among `others` */
  other: GridSwapPost | null
  others: GridSwapPost[]
  busy: boolean
}>()
const emit = defineEmits<{ swap: [a: GridSwapPost, b: GridSwapPost] }>()
const { t } = useI18n()

const picked = ref<string | undefined>(undefined)
watch(open, (now) => {
  if (now) picked.value = props.other?.id
})
const chosen = computed(
  () => props.other ?? props.others.find((o) => o.id === picked.value) ?? null,
)
const items = computed(() =>
  props.others.map((o) => ({ value: o.id, label: o.title, description: o.when })),
)
const title = computed(() =>
  props.post ? t('calendar.grid.swapTitle', { title: props.post.title }) : '',
)
function submit() {
  if (props.post && chosen.value) emit('swap', props.post, chosen.value)
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
        'w-[440px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
      header: 'min-h-0 border-0 px-5 pt-5 pb-1',
      title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em] break-words',
      body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
      footer: 'justify-end gap-2 px-5 py-3.5 sm:px-5 max-md:pb-5',
    }"
    data-grid-swap
  >
    <template #body>
      <form id="grid-swap" class="grid gap-4" novalidate @submit.prevent="submit">
        <URadioGroup
          v-if="!other"
          v-model="picked"
          :legend="$t('calendar.grid.swapWith')"
          :items="items"
          :ui="{
            fieldset: 'max-h-[min(20rem,50vh)] gap-0 overflow-y-auto',
            legend: 'mb-2 font-medium',
            item: 'min-h-11 items-center',
          }"
          data-grid-swap-choices
        />
        <p
          v-if="post && chosen"
          class="text-(--app-text-muted)"
          aria-live="polite"
          data-grid-swap-summary
        >
          {{
            $t('calendar.grid.swapSummary', {
              a: post.title,
              whenA: chosen.when,
              b: chosen.title,
              whenB: post.when,
            })
          }}
        </p>
      </form>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        class="max-md:flex-1 max-md:justify-center"
        @click="open = false"
      >
        {{ $t('calendar.grid.cancel') }}
      </UButton>
      <UButton
        type="submit"
        form="grid-swap"
        class="max-md:flex-1 max-md:justify-center"
        :loading="busy"
        :aria-disabled="!chosen || undefined"
        data-grid-swap-submit
      >
        {{ $t('calendar.grid.swap') }}
      </UButton>
    </template>
  </UModal>
</template>
