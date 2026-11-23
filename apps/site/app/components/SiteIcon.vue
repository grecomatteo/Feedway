<script setup lang="ts">
import { ICONS } from '~/icons'

defineProps<{ name: string }>()
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- static SVG from icons.ts, no user content -->
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS[name]" />
</template>
