<script setup lang="ts">
import { LEGAL, PLACEHOLDER } from '~/legal'

const props = defineProps<{ subject?: string }>()
const href = computed(
  () =>
    `mailto:${LEGAL.privacyEmail}` +
    (props.subject ? `?subject=${encodeURIComponent(props.subject)}` : ''),
)
</script>

<template>
  <mark v-if="LEGAL.privacyEmail === PLACEHOLDER" class="placeholder">{{ PLACEHOLDER }}</mark>
  <a v-else :href="href">{{ LEGAL.privacyEmail }}</a>
</template>
