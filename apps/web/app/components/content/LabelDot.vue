<script setup lang="ts">
import type { LabelColorName } from '~/composables/useContentSettings'

/** The mark of a label: an 8 px square in its colour (`.chip i` of base.css, B1). */
const props = defineProps<{ color: LabelColorName }>()
const colorOf = useLabelColor()
</script>

<template>
  <span
    class="inline-flex size-2 shrink-0 rounded-[2px]"
    :style="{ background: colorOf(props.color) }"
    aria-hidden="true"
  />
</template>
