<script setup lang="ts" generic="T extends string">
/**
 * The filter in a groove above a list («Attivi 5 · Archiviati 1»). Each choice is a toggle button
 * that says whether it is on; the count, when given, follows the word.
 */
defineProps<{ label: string; options: { value: T; label: string; count?: number }[] }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    class="inline-flex rounded-[0.625rem] border border-(--app-border) bg-(--app-groove) p-[3px]"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :aria-pressed="model === o.value"
      class="min-h-11 rounded-[0.4375rem] px-3.5 text-[0.84375rem] whitespace-nowrap transition-colors md:min-h-9"
      :class="
        model === o.value
          ? 'bg-(--app-card) font-semibold text-(--app-text) shadow-[0_1px_2px_rgb(36_35_33/0.15)]'
          : 'text-(--app-text-muted) hover:text-(--app-text)'
      "
      @click="model = o.value"
    >
      {{ o.label }}
      <span v-if="o.count !== undefined" class="tabular-nums">{{ o.count }}</span>
    </button>
  </div>
</template>
