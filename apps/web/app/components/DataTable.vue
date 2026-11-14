<script setup lang="ts" generic="T">
/**
 * A list with columns, on one card (DESIGN.md «Elenchi e tabelle»). Only data that changes from
 * row to row earns a column. Cells come from `#cell-<key>` slots; the last column is usually
 * `RowActions`, with a heading read only by screen readers. Below 768 px, when `#mobile` is
 * given, the table becomes rows on two levels (`DataRow`): name above, details under.
 */
export interface DataColumn {
  key: string
  label: string
  /** numbers and the actions go to the right */
  align?: 'start' | 'end'
  /** the heading is read, not shown (the «⋯» column) */
  hideLabel?: boolean
  class?: string
}

const props = defineProps<{
  caption: string
  columns: DataColumn[]
  rows: T[]
  rowKey: (row: T) => string
}>()
defineSlots<
  {
    [K in `cell-${string}`]?: (p: { row: T }) => unknown
  } & { mobile?: (p: { row: T }) => unknown }
>()
const keyOf = (row: T) => props.rowKey(row)
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)">
    <table class="w-full border-collapse text-sm" :class="$slots.mobile ? 'max-md:hidden' : ''">
      <caption class="sr-only">
        {{
          caption
        }}
      </caption>
      <thead>
        <tr>
          <th
            v-for="c in columns"
            :key="c.key"
            scope="col"
            class="border-b border-(--app-border-strong) px-4 py-2.5 text-[0.8125rem] font-medium text-(--app-text-muted)"
            :class="[c.align === 'end' ? 'text-right' : 'text-left', c.class]"
          >
            <span :class="c.hideLabel ? 'sr-only' : ''">{{ c.label }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="keyOf(row)"
          class="border-b border-(--app-border) last:border-b-0"
        >
          <td
            v-for="c in columns"
            :key="c.key"
            class="h-14 px-4 py-1"
            :class="[c.align === 'end' ? 'text-right' : 'text-left', c.class]"
          >
            <slot :name="`cell-${c.key}`" :row="row" />
          </td>
        </tr>
      </tbody>
    </table>
    <ul v-if="$slots.mobile" :aria-label="caption" class="divide-y divide-(--app-border) md:hidden">
      <template v-for="row in rows" :key="keyOf(row)">
        <slot name="mobile" :row="row" />
      </template>
    </ul>
  </div>
</template>
