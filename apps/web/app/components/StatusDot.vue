<script setup lang="ts">
/**
 * A state as a dot and a word (DESIGN.md). `neutral` when all is well, and often not shown at all;
 * a state colour only where someone has to act, always with the word.
 */
export type StatusTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

const props = withDefaults(defineProps<{ label: string; tone?: StatusTone }>(), {
  tone: 'neutral',
})

const DOT: Record<StatusTone, string> = {
  neutral: 'bg-(--app-border-strong)',
  success: 'bg-(--app-success)',
  info: 'bg-(--app-info)',
  warning: 'bg-(--app-warning) ring-3 ring-(--app-warning-soft)',
  danger: 'bg-(--app-danger) ring-3 ring-(--app-danger-soft)',
}
const WORD: Record<StatusTone, string> = {
  neutral: 'text-(--app-text-muted)',
  success: 'text-(--app-text)',
  info: 'text-(--app-text)',
  warning: 'font-semibold text-(--app-warning)',
  danger: 'font-semibold text-(--app-danger)',
}
const dot = computed(() => DOT[props.tone])
const word = computed(() => WORD[props.tone])
</script>

<template>
  <span
    class="inline-flex items-center gap-2 text-sm whitespace-nowrap"
    :class="word"
    :data-tone="tone"
  >
    <span class="size-2 shrink-0 rounded-full" :class="dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>
