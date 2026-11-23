<script setup lang="ts">
import { isShipped, type Feature } from '~/features'

const props = defineProps<{ feature?: Feature }>()
const show = computed(() => !isShipped(props.feature))
</script>

<template>
  <span v-if="show" class="soon-mark">In arrivo</span>
</template>
