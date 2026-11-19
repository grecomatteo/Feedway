<script setup lang="ts">
/**
 * Where a post goes or what a profile is: the platforms' icons in the muted colour, each with its
 * name for a screen reader; with `label` the handle or the name follows the icon («@fornoluce»).
 */
export type Platform = 'instagram' | 'facebook'

defineProps<{ platforms: Platform[]; label?: string }>()
const NAME: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook' }
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-(--app-text-muted)" data-platforms>
    <UIcon
      v-for="p in platforms"
      :key="p"
      :name="`i-lucide-${p}`"
      class="size-[15px] shrink-0"
      :aria-label="NAME[p]"
      role="img"
    />
    <span v-if="label" class="truncate">{{ label }}</span>
  </span>
</template>
