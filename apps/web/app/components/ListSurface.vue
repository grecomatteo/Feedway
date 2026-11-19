<script setup lang="ts">
/**
 * One white surface for a list (D-81): rows separated by a hairline, never a box inside a box.
 * `columns` is the grid of the rows (CSS `grid-template-columns`), shared by the head and every
 * `ListRow`; `head` names the columns, hidden on a phone where the rows show two lines instead.
 * With a head the surface is a table and its rows are table rows (each child of a `ListRow` then
 * takes `role="cell"`); without, a list. A column without a visible name (the «…» menu) takes
 * `{ label, hidden: true }`, read only by a screen reader.
 */
import { LIST_TABLE } from '~/utils/list-context'

type Head = string | { label: string; hidden: true }
const props = withDefaults(defineProps<{ columns?: string; head?: Head[]; label?: string }>(), {
  columns: 'minmax(0, 1fr) auto',
  head: () => [],
  label: undefined,
})
provide(
  LIST_TABLE,
  computed(() => props.head.length > 0),
)
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
      <span v-for="(h, i) in head" :key="i" role="columnheader">
        <template v-if="typeof h === 'string'">{{ h }}</template>
        <span v-else class="sr-only">{{ h.label }}</span>
      </span>
    </div>
    <slot />
  </div>
</template>
