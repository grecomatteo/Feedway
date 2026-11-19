<script setup lang="ts">
/**
 * The head of a section (D-81): the title in the system font, 14 semibold, its count in the muted
 * colour, and a link or a small action on the right. 32 high, 8 above the content.
 */
withDefaults(defineProps<{ title: string; count?: number | null; level?: 2 | 3 }>(), {
  count: null,
  level: 2,
})
</script>

<template>
  <div class="mb-2 flex h-8 items-center gap-2" data-section-head>
    <component :is="`h${level}`" class="min-w-0 truncate">
      {{ title }}
      <span v-if="count !== null" class="font-normal text-(--app-text-muted) tabular-nums">{{
        count
      }}</span>
    </component>
    <span class="flex-1" />
    <slot />
  </div>
</template>
