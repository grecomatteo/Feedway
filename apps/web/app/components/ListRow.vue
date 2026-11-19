<script setup lang="ts">
/**
 * A row of a `ListSurface`: 52 high on a computer, 60 on a phone, on the surface's grid. `columns`
 * overrides the grid for this row only (on a phone, for instance, two columns instead of five).
 */
withDefaults(defineProps<{ columns?: string; table?: boolean }>(), {
  columns: undefined,
  table: false,
})
</script>

<template>
  <div
    :role="table ? 'row' : 'listitem'"
    class="grid min-h-row grid-cols-(--cols) items-center gap-x-5 border-t border-(--app-border) px-4 first:border-t-0 max-md:gap-x-3 max-md:px-3.5 [[data-list-head]+&]:border-t-0"
    :style="columns ? { '--cols': columns } : undefined"
    data-list-row
  >
    <slot />
  </div>
</template>
