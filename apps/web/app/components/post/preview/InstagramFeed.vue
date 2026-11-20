<script setup lang="ts">
import type { PreviewItem } from '~/utils/post-preview'

/**
 * A photo or a carousel in Instagram's feed (design E4): the frame takes the first file's
 * proportions, a carousel scrolls with the arrows and the dots, the text is cut after two lines
 * with «… altro». The file shown is a model. No likes and no date under it: the column stays short
 * enough for «Controlli» (review of fidelity, A1).
 */
const props = defineProps<{
  name: string
  avatar: string | null
  items: PreviewItem[]
  frameRatio: number
  caption: string
}>()
const { t } = useI18n()

/** the position of the file shown in the carousel */
const at = defineModel<number>('at', { default: 0 })
watch(
  () => props.items.length,
  (n) => (at.value = Math.min(at.value, Math.max(0, n - 1))),
)
const current = computed(() => props.items[at.value])
const many = computed(() => props.items.length > 1)
function go(by: -1 | 1) {
  at.value = Math.min(props.items.length - 1, Math.max(0, at.value + by))
}
</script>

<template>
  <div class="flex flex-col pb-3" data-view="instagram_feed">
    <div class="flex items-center gap-2 px-3 py-2">
      <span
        class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--pv-sunken) text-[0.625rem] font-semibold ring-2 ring-[#d62976]"
        aria-hidden="true"
      >
        <img v-if="avatar" :src="avatar" alt="" class="size-full object-cover" />
        <template v-else>{{ name.slice(0, 2).toUpperCase() }}</template>
      </span>
      <span class="min-w-0 flex-1 truncate text-[0.78125rem] font-semibold">{{ name }}</span>
      <UIcon name="i-lucide-ellipsis" class="size-4" aria-hidden="true" />
    </div>
    <!-- overflow-hidden: without it a tall photo stretches the box past its 4:5 -->
    <div
      class="relative w-full overflow-hidden"
      :style="{ aspectRatio: String(frameRatio) }"
      :aria-roledescription="many ? t('posts.preview.carousel') : undefined"
    >
      <PostPreviewMedia v-if="current" :key="current.index" :item="current" />
      <span
        v-if="many"
        class="absolute top-2 right-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-[0.6875rem] font-semibold text-white"
        aria-live="polite"
      >
        {{ at + 1 }}/{{ items.length }}
      </span>
      <template v-if="many">
        <button
          v-if="at > 0"
          type="button"
          class="absolute top-1/2 left-1.5 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black"
          :aria-label="t('posts.preview.previous')"
          @click="go(-1)"
        >
          <UIcon name="i-lucide-chevron-left" class="size-4" aria-hidden="true" />
        </button>
        <button
          v-if="at < items.length - 1"
          type="button"
          class="absolute top-1/2 right-1.5 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black"
          :aria-label="t('posts.preview.next')"
          @click="go(1)"
        >
          <UIcon name="i-lucide-chevron-right" class="size-4" aria-hidden="true" />
        </button>
      </template>
    </div>
    <div class="flex items-center gap-3 px-3 pt-2" aria-hidden="true">
      <UIcon name="i-lucide-heart" class="size-5" />
      <UIcon name="i-lucide-message-circle" class="size-5" />
      <UIcon name="i-lucide-send" class="size-5" />
      <span class="flex flex-1 justify-center gap-1">
        <span
          v-for="(item, i) in many ? items : []"
          :key="item.index"
          class="size-1.5 rounded-full"
          :class="i === at ? 'bg-[#0095f6]' : 'bg-(--pv-dot)'"
        />
      </span>
      <UIcon name="i-lucide-bookmark" class="size-5" />
    </div>
    <div class="flex flex-col gap-1 px-3 pt-2">
      <PostPreviewCaption
        v-if="caption"
        :text="caption"
        :name="name"
        :limits="{ chars: 125, lines: 2 }"
        :more="t('posts.preview.more')"
        tone="instagram"
      />
    </div>
  </div>
</template>
