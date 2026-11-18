<script setup lang="ts">
/**
 * The frame of every panel page (D-63, DESIGN.md «Struttura delle pagine»): the head, then the
 * sections one under the other, with the spaces of the layout scale in main.css. The page uses the
 * whole width the layout gives it; only forms (`max-w-form`) and long text (`max-w-prose`) are
 * narrower, inside the sections. Without a title the page draws its own head in the `head` slot.
 */
defineProps<{ title?: string; summary?: string }>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-header">
    <slot name="head">
      <PageHeader v-if="title" :title="title" :summary="summary">
        <template v-if="$slots.summary" #summary><slot name="summary" /></template>
        <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      </PageHeader>
    </slot>
    <div class="flex min-w-0 flex-col gap-section">
      <slot />
    </div>
  </div>
</template>
