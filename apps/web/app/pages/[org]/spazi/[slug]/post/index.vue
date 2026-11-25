<script setup lang="ts">
/**
 * The old tab «Post» of the client: the list is now the calendar's «Elenco», in the tab
 * «Calendario» (plan 09 Task 3). An old link lands there, with the profile of the context.
 * The editor (`post/nuovo`, `post/[postId]`) stays where it is.
 */
definePageMeta({
  layout: 'agency',
  middleware: (to) => {
    const profilo = to.query['profilo']
    return navigateTo(
      {
        path: to.path.replace(/\/post\/?$/, '/calendario'),
        query: { vista: 'elenco', ...(typeof profilo === 'string' ? { profilo } : {}) },
      },
      { replace: true, redirectCode: 301 },
    )
  },
})
</script>

<template>
  <div />
</template>
