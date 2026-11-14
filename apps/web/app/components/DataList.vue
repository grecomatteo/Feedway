<script setup lang="ts">
/** One card for a list, rows separated by rules: never a box inside a box (DESIGN.md). */
defineProps<{ label: string }>()
</script>

<template>
  <ul
    :aria-label="label"
    class="divide-y divide-(--app-border) overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)"
  >
    <slot />
  </ul>
</template>
