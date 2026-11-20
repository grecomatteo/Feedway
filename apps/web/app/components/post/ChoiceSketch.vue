<script setup lang="ts">
/**
 * A drawing of what an option of a shape warning does to the file, beside its words: the frame
 * the platform shows (a reel 9:16, the feed between 4:5 and 1,91:1) with the file cut to fill it
 * («Ritagliato»), whole inside it with bands («Con le bande»), or left in its own shape («Così
 * com'è»). Two short sentences read fast are easy to mix up; a drawing is not.
 */
const props = defineProps<{
  /** the file's shape, width over height */
  source: number
  /** the frame's shape, width over height */
  target: number
  option: string
}>()

const H = 28
const box = computed(() => {
  const keep = props.option === 'keep'
  const ratio = keep ? props.source : props.target
  const frame = { w: Math.max(8, Math.round(H * ratio)), h: H }
  if (frame.w > 40) {
    frame.w = 40
    frame.h = Math.round(40 / ratio)
  }
  // the file inside the frame: filling it, or whole with bands
  const pad = props.option === 'pad'
  let media = { x: 0, y: 0, w: frame.w, h: frame.h }
  if (pad) {
    if (props.source > props.target) {
      const h = frame.w / props.source
      media = { x: 0, y: (frame.h - h) / 2, w: frame.w, h }
    } else {
      const w = frame.h * props.source
      media = { x: (frame.w - w) / 2, y: 0, w, h: frame.h }
    }
  }
  return { frame, media, pad }
})
</script>

<template>
  <svg
    :width="box.frame.w + 2"
    :height="box.frame.h + 2"
    :viewBox="`-1 -1 ${box.frame.w + 2} ${box.frame.h + 2}`"
    class="shrink-0"
    aria-hidden="true"
    data-choice-sketch
  >
    <rect
      :width="box.frame.w"
      :height="box.frame.h"
      rx="2"
      :class="box.pad ? 'fill-(--app-text)' : 'fill-none'"
      class="stroke-(--app-text-muted)"
      stroke-width="1"
    />
    <rect
      :x="box.media.x"
      :y="box.media.y"
      :width="box.media.w"
      :height="box.media.h"
      :rx="box.pad ? 0 : 2"
      class="fill-(--app-info-soft) stroke-(--app-info) [stroke-width:1]"
    />
    <!-- the same sun in every option, so the cut shows -->
    <circle
      :cx="box.media.x + box.media.w * 0.68"
      :cy="box.media.y + box.media.h * 0.32"
      :r="Math.max(1.5, Math.min(box.media.w, box.media.h) * 0.12)"
      class="fill-(--app-text-muted)"
    />
  </svg>
</template>
