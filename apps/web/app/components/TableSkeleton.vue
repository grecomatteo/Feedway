<script setup lang="ts">
/**
 * The shape of a `DataTable` while it loads: the column headings as they will be, rows of 56 px
 * with the picture in the first cell and «⋯» in the last. Below 768 px it is a `ListSkeleton`,
 * as the table becomes rows there. Screen readers hear `label` once.
 */
const props = withDefaults(
  defineProps<{ label: string; columns: string[]; rows?: number; action?: boolean }>(),
  { rows: 3, action: true },
)
const widths = ['w-36', 'w-48', 'w-28', 'w-40', 'w-32']
const cells = computed(() => props.columns.length)
</script>

<template>
  <div role="status">
    <span class="sr-only">{{ label }}</span>
    <div
      aria-hidden="true"
      class="overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card) max-md:hidden"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              v-for="c in columns"
              :key="c"
              class="border-b border-(--app-border-strong) px-4 py-2.5 text-left text-[0.8125rem] font-medium text-(--app-text-muted)"
            >
              {{ c }}
            </th>
            <th v-if="action" class="w-13 border-b border-(--app-border-strong)" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in rows"
            :key="i"
            data-skeleton-row
            class="border-b border-(--app-border) last:border-b-0"
          >
            <td v-for="n in cells" :key="n" class="h-14 px-4 py-1">
              <span v-if="n === 1" class="flex items-center gap-3">
                <span class="skeleton size-8 shrink-0 rounded-full" />
                <span :class="['skeleton block h-3.5 rounded', widths[(i - 1) % widths.length]]" />
              </span>
              <span v-else class="skeleton block h-3 w-24 max-w-full rounded" />
            </td>
            <td v-if="action" class="h-14 px-2">
              <span class="skeleton block size-8 rounded-md" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ListSkeleton :rows="rows" :action="action" class="md:hidden" />
  </div>
</template>
