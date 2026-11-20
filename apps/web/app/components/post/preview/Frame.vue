<script setup lang="ts">
/**
 * The box around a preview (Matteo, 18 November 2026: no phone, a plain rectangle with the
 * platform's interface): the app's own colours, white for the feed and the Page's posts, black
 * for reels and stories, in the panel's dark theme too. A reel or a story is exactly 9:16, so
 * the covered zones are fractions of the frame Meta measures them on, and short enough to fit
 * the screen's height. In the editor's column a reel is 236 px wide (screen 09).
 */
const props = withDefaults(
  defineProps<{
    vertical?: boolean
    /** the screen's height kept for what stands above and below the frame */
    reserve?: string
    /** a reel or a story is never wider than this */
    width?: string
    /**
     * the feed's photo (width / height) and the screen's height kept around it, header and text
     * of the app included: on a low screen the feed narrows so «Controlli» stay in view (A1)
     */
    feed?: { ratio: number; reserve: string }
  }>(),
  { reserve: '20rem', width: '100%', feed: undefined },
)
// never narrower than 12rem, where the app's names and buttons still read
const maxWidth = computed(() =>
  props.vertical
    ? `max(12rem, min(${props.width}, 100%, calc((100dvh - ${props.reserve}) * 9 / 16)))`
    : props.feed
      ? `max(16rem, min(100%, calc((100dvh - ${props.feed.reserve}) * ${String(props.feed.ratio)})))`
      : undefined,
)
</script>

<template>
  <div
    class="relative mx-auto w-full overflow-hidden rounded-[4px] border"
    :class="
      vertical
        ? 'aspect-[9/16] border-black bg-black text-white'
        : 'border-(--app-border-strong) bg-white text-[#141414]'
    "
    :style="maxWidth ? { maxWidth } : undefined"
    data-preview-frame
  >
    <slot />
  </div>
</template>
