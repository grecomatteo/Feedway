<script setup lang="ts">
/**
 * What a list says when it has nothing (Task R9): the line of «Niente da sistemare.» (screen 03) on
 * the surface the list would have, at least as tall as one of its rows. The icon, what is missing,
 * a hint under it and, at the end, the action that fills it (the slot). Never a dashed box.
 */
defineProps<{ title: string; text?: string; icon?: string }>()
</script>

<template>
  <div
    class="flex min-h-row flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-(--app-border) bg-(--app-surface) px-4 py-3 max-md:px-3.5"
    data-empty-state
  >
    <UIcon
      :name="icon ?? 'i-lucide-inbox'"
      class="size-4 shrink-0 text-(--app-text-muted)"
      aria-hidden="true"
    />
    <div class="min-w-0 flex-1">
      <p class="font-medium">{{ title }}</p>
      <p v-if="text" class="text-detail text-(--app-text-muted)">{{ text }}</p>
    </div>
    <slot />
  </div>
</template>
