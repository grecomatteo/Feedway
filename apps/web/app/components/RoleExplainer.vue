<script setup lang="ts">
/** What each role per client may do (spec §10.2), next to the invite and the role choices. */
const roles = ['manager', 'publisher', 'editor', 'viewer'] as const
</script>

<template>
  <dl class="space-y-2 text-sm">
    <div v-for="r in roles" :key="r">
      <dt class="font-semibold">{{ $t(`roles.${r}`) }}</dt>
      <dd class="text-(--app-text-muted)">{{ $t(`roleExplain.${r}`) }}</dd>
    </div>
  </dl>
</template>
