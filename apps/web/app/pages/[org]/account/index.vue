<script setup lang="ts">
// «Account social» moved to Impostazioni → Integrazioni → Meta (plan 04 Task 6c): old links and
// bookmarks land there, with the same context; who does not manage the connections lands in Clienti.
const org = useOrganization()
const route = useRoute()
await navigateTo(
  {
    path: org.to(org.may.value.manageAccounts ? '/impostazioni/integrazioni/meta' : '/spazi'),
    query: route.query,
    hash: route.hash,
  },
  { replace: true },
)
</script>

<template>
  <div />
</template>
