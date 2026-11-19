<script setup lang="ts">
/**
 * The line above a list (D-81): the filter, the search and an outlined action on the same row,
 * 12 apart and 12 above the list. On a phone the filter takes the whole width.
 */
</script>

<template>
  <div
    class="mb-3 flex flex-wrap items-center gap-3 max-md:[&>[data-segmented]]:flex max-md:[&>[data-segmented]]:w-full max-md:[&>[data-segmented]]:overflow-x-auto max-md:[&>[data-segmented]>button]:flex-1"
    data-toolbar
  >
    <slot />
  </div>
</template>
