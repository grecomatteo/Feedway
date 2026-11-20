<script setup lang="ts">
// The agency's privacy notice moved inside Impostazioni → Privacy (Task R8): old links and
// bookmarks land there.
const route = useRoute()
await navigateTo(
  { path: '/account/privacy', query: route.query, hash: route.hash },
  { replace: true },
)
</script>

<template>
  <div />
</template>
