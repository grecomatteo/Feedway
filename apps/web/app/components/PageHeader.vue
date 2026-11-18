<script setup lang="ts">
/**
 * The head of a page (DESIGN.md «Elenchi e tabelle» and «Struttura delle pagine»): the title,
 * under it, only when it says something the title does not, one sentence that sums up the page
 * and links to the first problem; the page's main action on the right. No big numbers or count
 * tiles. The space around it belongs to PageShell.
 */
defineProps<{ title?: string; summary?: string }>()
</script>

<template>
  <header class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
    <div class="min-w-0 flex-1">
      <h1 class="text-[1.625rem] leading-tight break-words md:text-[1.875rem]">
        <slot name="title">{{ title }}</slot>
      </h1>
      <p v-if="summary || $slots.summary" class="mt-1 max-w-prose text-(--app-text-muted)">
        <slot name="summary">{{ summary }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
