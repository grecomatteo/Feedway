<script setup lang="ts" generic="T extends string">
/**
 * The filter above a list («Tutti 9 · Bozze 2 · Programmati 3», D-81): toggle buttons in a sunken
 * well, the chosen one on a white surface. On a phone each choice is 36 high, and in a `Toolbar`
 * the filter fills the line.
 */
withDefaults(
  defineProps<{
    label: string
    options: { value: T; label: string; count?: number; disabled?: boolean }[]
    /** Every choice as wide as the others, on the whole width (the editor's «Tipo»). */
    wide?: boolean
  }>(),
  { wide: false },
)
const model = defineModel<T>({ required: true })
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    class="gap-0.5 rounded-control border border-(--app-border) bg-(--app-surface-sunken) p-[3px]"
    :class="wide ? 'flex' : 'inline-flex'"
    data-segmented
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :aria-pressed="model === o.value"
      :disabled="o.disabled"
      class="inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] px-2.5 whitespace-nowrap transition-colors disabled:opacity-55 max-md:h-9"
      :class="[
        wide ? 'flex-1' : '',
        model === o.value
          ? 'bg-(--app-surface) font-semibold text-(--app-text) shadow-[var(--app-shadow-1),0_0_0_1px_var(--app-border)]'
          : 'font-medium text-(--app-text-muted) enabled:hover:text-(--app-text)',
      ]"
      @click="model = o.value"
    >
      <slot name="option" :option="o">{{ o.label }}</slot>
      <span v-if="o.count !== undefined" class="font-normal text-(--app-text-muted) tabular-nums">{{
        o.count
      }}</span>
    </button>
  </div>
</template>
