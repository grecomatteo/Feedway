<script setup lang="ts">
// «Aggiungi account» moved under Impostazioni → Integrazioni → Meta (plan 04 Task 6c): old links
// and bookmarks land there, with the same context; who does not manage the connections, in Clienti.
const org = useOrganization()
const route = useRoute()
await navigateTo(
  {
    path: org.to(
      org.may.value.manageAccounts ? '/impostazioni/integrazioni/meta/aggiungi' : '/spazi',
    ),
    query: route.query,
    hash: route.hash,
  },
  { replace: true },
)
</script>

<template>
  <div />
</template>
