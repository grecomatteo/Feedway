<script setup lang="ts">
// «Clienti → Account» became the Panoramica of the client's page (plan 04 Task 6a): old links
// and bookmarks land there, with the same context.
definePageMeta({
  redirect: (to) => ({
    path: to.path.replace(/\/account\/?$/, ''),
    query: to.query,
    hash: to.hash,
  }),
})
</script>

<template>
  <div />
</template>
