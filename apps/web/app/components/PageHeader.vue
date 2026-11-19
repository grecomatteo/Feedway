<script setup lang="ts">
/**
 * The head of a page (D-81): the title, Sora 22, with what belongs beside it (a date, a count) in
 * the muted colour, and the page's action on the right. No subtitle: a sentence appears only where
 * it says what to do, next to the point it is about. `summary` stays for the pages that are not
 * redrawn yet, and goes with them.
 */
defineProps<{ title?: string; summary?: string }>()
</script>

<template>
  <header class="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 max-md:gap-x-3">
    <h1 class="min-w-0 break-words">
      <slot name="title">{{ title }}</slot>
    </h1>
    <span v-if="$slots.aside" class="text-(--app-text-muted)" data-page-aside>
      <slot name="aside" />
    </span>
    <span class="flex-1" />
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
    <p
      v-if="summary || $slots.summary"
      class="w-full max-w-prose text-(--app-text-muted)"
      data-page-summary
    >
      <slot name="summary">{{ summary }}</slot>
    </p>
  </header>
</template>
