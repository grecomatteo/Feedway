<script setup lang="ts">
// Uses the original SVG files from the brand kit: the lettering is never retyped.
withDefaults(defineProps<{ variant?: 'carbone' | 'arancio' | 'bianco', width?: number }>(), { variant: 'carbone', width: 160 })
</script>

<template>
  <img :src="`/brand/feedway-horizontal-${variant}.svg`" alt="Feedway" :width="width" :height="Math.round(width * 256 / 881)" class="block">
</template>
