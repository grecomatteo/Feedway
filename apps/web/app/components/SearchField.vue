<script setup lang="ts">
/**
 * The search above a list: one field with a magnifier, its label read by screen readers and shown
 * as the hint. Esc or the cross empties it. Full width on a phone, under the filter.
 */
defineProps<{ label: string }>()
const model = defineModel<string>({ default: '' })
const input = ref<HTMLInputElement | null>(null)
function clear() {
  model.value = ''
  input.value?.focus()
}
</script>

<template>
  <div
    class="flex min-h-11 w-full items-center gap-2 rounded-lg border border-(--app-border-strong) bg-(--app-card) pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--app-focus) md:max-w-80"
  >
    <UIcon name="i-lucide-search" class="size-[1.125rem] shrink-0 text-(--app-text-muted)" />
    <input
      ref="input"
      v-model="model"
      type="search"
      :aria-label="label"
      :placeholder="label"
      class="min-w-0 flex-1 bg-transparent py-2 text-sm text-(--app-text) placeholder:text-(--app-text-muted) focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      @keydown.esc="model ? clear() : undefined"
    />
    <button
      v-if="model"
      type="button"
      class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-(--app-text-muted) hover:text-(--app-text)"
      :aria-label="$t('lists.clearSearch')"
      @click="clear"
    >
      <UIcon name="i-lucide-x" class="size-4" />
    </button>
  </div>
</template>
