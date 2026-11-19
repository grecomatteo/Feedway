<script setup lang="ts">
/**
 * A row of the editor (screens 08 and 09): the label on the left, what it holds on the right, a
 * line between rows. On a phone the label goes on top, with its detail («2 di 10») at the end.
 */
defineProps<{
  /** the id of the label, which names the section */
  heading: string
  label: string
  /** under the label: how many files, how many accounts */
  detail?: string | null
}>()
</script>

<template>
  <section
    :aria-labelledby="heading"
    class="grid gap-x-6 border-t border-(--app-border) py-[1.375rem] first:border-t-0 md:grid-cols-[8rem_minmax(0,1fr)] max-md:py-[1.125rem]"
    data-editor-row
  >
    <div class="md:pt-2 max-md:flex max-md:items-baseline max-md:gap-2 max-md:pb-2.5">
      <h2 :id="heading">{{ label }}</h2>
      <p
        v-if="detail"
        class="text-detail text-(--app-text-muted) max-md:ms-auto"
        aria-live="polite"
        data-row-detail
      >
        {{ detail }}
      </p>
    </div>
    <div class="min-w-0">
      <slot />
    </div>
  </section>
</template>
