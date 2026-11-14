<script setup lang="ts">
/**
 * The shape of a `DataList` while it loads: rows as tall as the real ones (56 px on a computer,
 * 64 on a phone), the picture, two lines and the place of «⋯». Never a sentence; screen readers
 * hear `label` once. Without `label` it is only the shape, for a skeleton that announces itself.
 */
withDefaults(defineProps<{ label?: string; rows?: number; action?: boolean }>(), {
  label: undefined,
  rows: 3,
  action: true,
})
const widths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36']
</script>

<template>
  <div :role="label ? 'status' : undefined">
    <span v-if="label" class="sr-only">{{ label }}</span>
    <ul
      aria-hidden="true"
      class="divide-y divide-(--app-border) overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)"
    >
      <li
        v-for="i in rows"
        :key="i"
        data-skeleton-row
        class="flex h-16 items-center gap-3 pr-2 pl-4 md:h-14"
      >
        <span class="skeleton size-8 shrink-0 rounded-full" />
        <span class="min-w-0 flex-1 space-y-2">
          <span
            :class="['skeleton block h-3.5 max-w-full rounded', widths[(i - 1) % widths.length]]"
          />
          <span class="skeleton block h-3 w-20 rounded" />
        </span>
        <span v-if="action" class="skeleton mr-1.5 size-8 shrink-0 rounded-md" />
      </li>
    </ul>
  </div>
</template>
