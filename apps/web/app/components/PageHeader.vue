<script setup lang="ts">
/**
 * The head of a list page (DESIGN.md «Elenchi e tabelle»): the title, under it one sentence that
 * sums up the list and links to the first problem, the page's main action on the right. No big
 * numbers or count tiles.
 */
defineProps<{ title: string; summary?: string }>()
</script>

<template>
  <header class="mb-5 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="text-[1.625rem] leading-tight md:text-[1.875rem]">{{ title }}</h1>
      <p v-if="summary || $slots.summary" class="mt-1 text-(--app-text-muted)">
        <slot name="summary">{{ summary }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
