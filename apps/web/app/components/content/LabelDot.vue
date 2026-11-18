<script setup lang="ts">
import type { LabelColorName } from '~/composables/useContentSettings'

/** The dot of a label's colour, ringed so a pale accent still shows on a light page (D-68). */
const props = defineProps<{ color: LabelColorName }>()
const colorOf = useLabelColor()
</script>

<template>
  <span
    class="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-(--app-border-strong)"
    :style="{ background: colorOf(props.color) }"
    aria-hidden="true"
  />
</template>
