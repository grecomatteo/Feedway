<script setup lang="ts">
/**
 * One white surface for a list (D-81): rows separated by a hairline, never a box inside a box.
 * `columns` is the grid of the rows (CSS `grid-template-columns`), shared by the head and every
 * `ListRow`; `head` names the columns, hidden on a phone where the rows show two lines instead.
 */
withDefaults(defineProps<{ columns?: string; head?: string[]; label?: string }>(), {
  columns: 'minmax(0, 1fr) auto',
  head: () => [],
  label: undefined,
})
</script>

<template>
  <div
    class="grid rounded-card border border-(--app-border) bg-(--app-surface)"
    :style="{ '--cols': columns }"
    :role="head.length ? 'table' : 'list'"
    :aria-label="label"
    data-list-surface
  >
    <div
      v-if="head.length"
      role="row"
      data-list-head
      class="grid min-h-9 grid-cols-(--cols) items-center gap-x-5 border-b border-(--app-border) px-4 text-caption font-medium text-(--app-text-muted) max-md:hidden"
    >
      <span v-for="(h, i) in head" :key="i" role="columnheader">{{ h }}</span>
    </div>
    <slot />
  </div>
</template>
