<script setup lang="ts">
import { PLACEHOLDER } from '~/legal'

defineProps<{ value: string }>()
</script>

<template>
  <mark v-if="value === PLACEHOLDER" class="placeholder">{{ value }}</mark>
  <strong v-else>{{ value }}</strong>
</template>
