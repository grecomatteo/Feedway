<script setup lang="ts">
/**
 * Where a post goes or what a profile is: the platforms' icons in the muted colour, each with its
 * name for a screen reader; with `label` the handle or the name follows the icon («@fornoluce»).
 */
export type Platform = 'instagram' | 'facebook'

defineProps<{ platforms: Platform[]; label?: string }>()
// literal names, so the icon bundle sees them
const ICON: Record<Platform, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const NAME: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook' }
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-(--app-text-muted)" data-platforms>
    <template v-for="p in platforms" :key="p">
      <UIcon :name="ICON[p]" class="size-[15px] shrink-0" aria-hidden="true" />
      <span class="sr-only">{{ NAME[p] }}</span>
    </template>
    <span v-if="label" class="truncate">{{ label }}</span>
  </span>
</template>
