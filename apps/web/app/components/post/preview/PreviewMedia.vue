<script setup lang="ts">
import { cropStyle, type PreviewItem } from '~/utils/post-preview'

/**
 * One file in its box, after the answer to its warning (D-61): the whole box (`fill`), the
 * whole file with bands (`contain`) or only the crop's box (`crop`). A video plays when
 * touched and starts from its cover (§11.3).
 */

const props = defineProps<{
  item: PreviewItem
  /** the colour of the bands */
  dark?: boolean
  /** a video starts from here (the reel's cover, in ms) */
  startMs?: number
}>()
const { t } = useI18n()

const video = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
function toggle() {
  const v = video.value
  if (!v) return
  if (v.paused) void v.play().catch(() => undefined)
  else v.pause()
}
function seek() {
  const v = video.value
  if (v && props.startMs !== undefined && v.paused) v.currentTime = props.startMs / 1000
}
watch(() => props.startMs, seek)

const fit = computed(() =>
  props.item.framing.mode === 'contain' ? 'object-contain' : 'object-cover',
)
const boxed = computed(() =>
  props.item.framing.mode === 'crop' && props.item.framing.crop
    ? cropStyle(props.item.framing.crop)
    : null,
)
</script>

<template>
  <div
    class="relative size-full overflow-hidden"
    :class="dark ? 'bg-black' : 'bg-[#efefef]'"
    :data-preview-file="item.index"
    :data-framing="item.framing.mode"
  >
    <template v-if="item.src">
      <video
        v-if="item.video"
        ref="video"
        :src="item.src"
        :poster="item.poster ?? undefined"
        muted
        playsinline
        loop
        preload="metadata"
        class="block"
        :class="boxed ? '' : ['size-full', fit]"
        :style="boxed ?? undefined"
        @loadedmetadata="seek"
        @play="playing = true"
        @pause="playing = false"
      />
      <img
        v-else
        :src="item.src"
        :alt="item.name"
        draggable="false"
        class="block select-none"
        :class="boxed ? '' : ['size-full', fit]"
        :style="boxed ?? undefined"
      />
      <button
        v-if="item.video"
        type="button"
        class="absolute inset-0 z-10 flex items-center justify-center"
        :aria-label="playing ? t('posts.preview.pause') : t('posts.preview.play')"
        @click="toggle"
      >
        <span
          v-if="!playing"
          class="flex size-12 items-center justify-center rounded-full bg-black/45 text-white"
          aria-hidden="true"
        >
          <UIcon name="i-lucide-play" class="size-6" />
        </span>
      </button>
    </template>
    <div
      v-else
      class="flex size-full flex-col items-center justify-center gap-1 p-3 text-center text-xs"
      :class="dark ? 'text-white/70' : 'text-[#737373]'"
    >
      <UIcon
        :name="item.video ? 'i-lucide-film' : 'i-lucide-image'"
        class="size-6"
        aria-hidden="true"
      />
      <span class="line-clamp-2 break-all">{{ item.name }}</span>
    </div>
  </div>
</template>
