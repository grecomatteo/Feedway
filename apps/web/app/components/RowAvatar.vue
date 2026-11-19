<script setup lang="ts">
/**
 * The picture at the start of a client's row: its Instagram or Page photo as Feedway keeps it, or
 * its initials, in the client's square (`Avatar`). The agency's logo is `AgencyLogo`.
 */
withDefaults(defineProps<{ name: string; src?: string | null; size?: 'row' | 'page' }>(), {
  src: null,
  size: 'row',
})
</script>

<template>
  <Avatar :name="name" :src="src" kind="client" :size="size === 'page' ? 56 : 28" />
</template>
