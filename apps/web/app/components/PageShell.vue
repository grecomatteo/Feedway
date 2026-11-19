<script setup lang="ts">
/**
 * The frame of every panel page (D-81): the head, then the sections one under the other. The
 * content is as wide as the layout gives it up to 1200, then it stops (it replaces «no limit» of
 * D-63). Without a title the page draws its own head in the `head` slot.
 */
defineProps<{ title?: string; summary?: string }>()
</script>

<template>
  <div class="flex w-full max-w-content min-w-0 flex-col gap-5 max-md:gap-4" data-page-shell>
    <slot name="head">
      <PageHeader v-if="title" :title="title" :summary="summary">
        <template v-if="$slots.aside" #aside><slot name="aside" /></template>
        <template v-if="$slots.summary" #summary><slot name="summary" /></template>
        <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      </PageHeader>
    </slot>
    <div class="flex min-w-0 flex-col gap-section">
      <slot />
    </div>
  </div>
</template>
