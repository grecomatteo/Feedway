<script setup lang="ts">
const palette = usePalette()
// only the --app-* variables change (packages/ui/tokens.css): pages and components stay the same
useHead({
  htmlAttrs: {
    'data-palette': computed(() => (palette.value === 'feedway' ? undefined : palette.value)),
  },
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
