<script setup lang="ts">
/** A person: their photo, or their initials on warm grey, always round (`Avatar`). */
withDefaults(
  defineProps<{ name: string; src?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' }>(),
  { src: null, size: 'sm' },
)
const PX = { xs: 22, sm: 28, md: 40, lg: 96 } as const
</script>

<template>
  <Avatar :name="name" :src="src" kind="person" :size="PX[size]" />
</template>
