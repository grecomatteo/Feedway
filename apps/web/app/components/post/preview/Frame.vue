<script setup lang="ts">
/**
 * The box around a preview (Matteo, 18 November 2026: no phone, a plain rectangle with the
 * platform's interface): the app's own colours, white for the feed and the Page's posts, black
 * for reels and stories, in the panel's dark theme too. A reel or a story is exactly 9:16, so
 * the covered zones are fractions of the frame Meta measures them on, and short enough to fit
 * the screen's height.
 */
defineProps<{ vertical?: boolean }>()
</script>

<template>
  <div
    class="relative mx-auto w-full overflow-hidden border"
    :class="
      vertical
        ? 'aspect-[9/16] border-black bg-black text-white'
        : 'border-[#dbdbdb] bg-white text-[#141414]'
    "
    :style="vertical ? { maxWidth: 'min(100%, calc((100dvh - 20rem) * 9 / 16))' } : undefined"
    data-preview-frame
  >
    <slot />
  </div>
</template>
