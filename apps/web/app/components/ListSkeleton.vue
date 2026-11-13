<script setup lang="ts">
/**
 * The shape of a list while it loads: rows as tall as the real ones (64 px), with the picture,
 * two lines of text and the place of the button. Screen readers hear `label` once.
 */
withDefaults(defineProps<{ label: string; rows?: number; action?: boolean }>(), {
  rows: 3,
  action: true,
})
const widths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36']
</script>

<template>
  <div role="status" aria-busy="true">
    <span class="sr-only">{{ label }}</span>
    <ul
      aria-hidden="true"
      class="divide-y divide-(--app-border) overflow-hidden rounded-xl border border-(--app-border) bg-(--app-surface)"
    >
      <li v-for="i in rows" :key="i" class="flex min-h-16 items-center gap-3 px-4 py-2">
        <span class="skeleton size-8 shrink-0 rounded-full" />
        <span class="min-w-0 flex-1 space-y-2">
          <span :class="['skeleton block h-3.5 max-w-full rounded', widths[(i - 1) % widths.length]]" />
          <span class="skeleton block h-3 w-20 rounded" />
        </span>
        <span v-if="action" class="skeleton h-9 w-11 shrink-0 rounded-md sm:w-32" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.skeleton {
  background: var(--app-surface-sunken);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  50% {
    opacity: 0.55;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
