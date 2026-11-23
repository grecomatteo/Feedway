<script setup lang="ts">
import { PLACEHOLDER } from '~/legal'

// `fallback`: a generic wording used while the fact is not filled in, so it does not block the release
defineProps<{ value: string; fallback?: string }>()
</script>

<template>
  <template v-if="value === PLACEHOLDER">
    <span v-if="fallback">{{ fallback }}</span>
    <mark v-else class="placeholder">{{ value }}</mark>
  </template>
  <strong v-else>{{ value }}</strong>
</template>
