<script setup lang="ts">
/**
 * A state as a dot and a word (D-81): full colour only where someone has to act. Give `status` for
 * the states of a post or a profile, or `tone` for anything else.
 */
export type StatusTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'
export type StatusKind = 'draft' | 'scheduled' | 'published' | 'failed' | 'reconnect' | 'paused'

const props = withDefaults(
  defineProps<{ label: string; tone?: StatusTone; status?: StatusKind }>(),
  { tone: 'neutral', status: undefined },
)

const TONE_OF: Record<StatusKind, StatusTone> = {
  draft: 'neutral',
  scheduled: 'info',
  published: 'success',
  failed: 'danger',
  reconnect: 'warning',
  paused: 'neutral',
}
const DOT: Record<StatusTone, string> = {
  neutral: 'bg-(--app-neutral-dot)',
  success: 'bg-(--app-success)',
  info: 'bg-(--app-info)',
  warning: 'bg-(--app-warning-dot) ring-3 ring-(--app-warning-soft)',
  danger: 'bg-(--app-danger) ring-3 ring-(--app-danger-soft)',
}
const WORD: Record<StatusTone, string> = {
  neutral: 'text-(--app-text-muted)',
  success: 'text-(--app-text)',
  info: 'text-(--app-text)',
  warning: 'font-medium text-(--app-warning)',
  danger: 'font-medium text-(--app-danger)',
}
const tone = computed(() => (props.status ? TONE_OF[props.status] : props.tone))
</script>

<template>
  <span
    class="inline-flex max-w-full items-center gap-2 whitespace-nowrap"
    :class="WORD[tone]"
    :data-tone="tone"
    :data-status="status"
  >
    <span class="size-2 shrink-0 rounded-full" :class="DOT[tone]" aria-hidden="true" />
    <!-- in a narrow column the word ends with an ellipsis instead of running into the next one -->
    <span class="min-w-0 truncate">{{ label }}</span>
  </span>
</template>
