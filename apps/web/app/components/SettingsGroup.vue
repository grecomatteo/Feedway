<script setup lang="ts">
/**
 * A group of the settings (screens 23–26): its title in the system font, 14 semibold, then one
 * white surface with its `SettingsRow`s. The title names the region for a screen reader.
 */
withDefaults(defineProps<{ title: string; bare?: boolean }>(), { bare: false })
const id = useId()
</script>

<template>
  <section :aria-labelledby="id" data-settings-group>
    <div class="mb-2.5 flex min-h-5 items-center gap-2">
      <h2 :id="id" class="min-w-0 flex-1">{{ title }}</h2>
      <slot name="aside" />
    </div>
    <slot v-if="bare" />
    <div v-else class="rounded-card border border-(--app-border) bg-(--app-surface)">
      <slot />
    </div>
  </section>
</template>
