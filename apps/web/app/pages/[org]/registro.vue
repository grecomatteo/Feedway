<script setup lang="ts">
// Registro attività moved inside Impostazioni (Task R8): old links and bookmarks land there.
const org = useOrganization()
const route = useRoute()
await navigateTo(
  { path: org.to('/impostazioni/registro'), query: route.query, hash: route.hash },
  { replace: true },
)
</script>

<template>
  <div />
</template>
