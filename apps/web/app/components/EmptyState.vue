<script setup lang="ts">
defineProps<{ title: string; text?: string; icon?: string }>()
</script>

<template>
  <div
    class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-(--app-border-strong) p-8 text-center"
  >
    <UIcon
      :name="icon ?? 'i-lucide-inbox'"
      class="size-6 text-(--app-text-muted)"
      aria-hidden="true"
    />
    <p class="font-semibold">{{ title }}</p>
    <p v-if="text" class="text-sm text-(--app-text-muted)">{{ text }}</p>
    <slot />
  </div>
</template>
