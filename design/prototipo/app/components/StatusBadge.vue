<script setup lang="ts">
import { TONE_STYLE, type StatusView } from '~/utils/format'

const props = defineProps<{ status: StatusView, plain?: boolean }>()
const style = computed(() => TONE_STYLE[props.status.tone])
</script>

<template>
  <span v-if="plain" class="inline-flex items-start gap-1.5 text-[13px] font-semibold leading-tight" :style="{ color: style.color }">
    <UIcon :name="status.icon" class="size-3.5 shrink-0 mt-px" aria-hidden="true" />
    <span>{{ status.label }}</span>
  </span>
  <span v-else class="fw-badge" :style="{ color: style.color, background: style.bg }">
    <UIcon :name="status.icon" class="size-3.5" aria-hidden="true" />
    {{ status.label }}
  </span>
</template>
