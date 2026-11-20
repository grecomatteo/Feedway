<script setup lang="ts">
import type { PreviewItem } from '~/utils/post-preview'

/**
 * A post of a Facebook Page (design E4): the text above the files, cut with «… Altro»; one
 * file whole, two side by side, three or more as a large one and a column, with «+N».
 */
const props = defineProps<{
  name: string
  avatar: string | null
  items: PreviewItem[]
  caption: string
  when: string
}>()
const { t } = useI18n()
const shown = computed(() => props.items.slice(0, 3))
const hidden = computed(() => props.items.length - shown.value.length)
const single = computed(() => (props.items.length === 1 ? props.items[0] : undefined))
</script>

<template>
  <div class="flex flex-col" data-view="facebook_post">
    <div class="flex items-center gap-2 px-3 py-2">
      <span
        class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--pv-sunken) text-[0.625rem] font-semibold"
        aria-hidden="true"
      >
        <img v-if="avatar" :src="avatar" alt="" class="size-full object-cover" />
        <template v-else>{{ name.slice(0, 2).toUpperCase() }}</template>
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-[0.78125rem] font-semibold">{{ name }}</span>
        <span class="flex items-center gap-1 text-[0.625rem] text-(--pv-muted)">
          {{ when }}
          <UIcon name="i-lucide-globe" class="size-2.5" aria-hidden="true" />
        </span>
      </span>
      <UIcon name="i-lucide-ellipsis" class="size-4" aria-hidden="true" />
    </div>
    <div v-if="caption" class="px-3 pb-2">
      <PostPreviewCaption
        :text="caption"
        :limits="{ chars: 180, lines: 3 }"
        :more="t('posts.preview.moreFacebook')"
        tone="facebook"
      />
    </div>
    <div v-if="single" class="aspect-[4/5] w-full">
      <PostPreviewMedia :item="single" />
    </div>
    <div v-else-if="items.length === 2" class="grid aspect-square grid-cols-2 gap-0.5">
      <PostPreviewMedia v-for="item in items" :key="item.index" :item="item" />
    </div>
    <div v-else-if="items.length > 2" class="grid aspect-square grid-cols-[2fr_1fr] gap-0.5">
      <div class="row-span-2">
        <PostPreviewMedia v-if="shown[0]" :item="shown[0]" />
      </div>
      <PostPreviewMedia v-if="shown[1]" :item="shown[1]" />
      <div class="relative">
        <PostPreviewMedia v-if="shown[2]" :item="shown[2]" />
        <span
          v-if="hidden > 0"
          class="absolute inset-0 z-20 flex items-center justify-center bg-black/45 text-lg font-semibold text-white"
        >
          +{{ hidden }}
        </span>
      </div>
    </div>
    <p class="border-b border-(--pv-line) px-3 py-1.5 text-[0.625rem] text-(--pv-muted)">
      {{ t('posts.preview.firstReaction') }}
    </p>
    <div
      class="flex justify-around px-2 py-2 text-[0.6875rem] font-semibold text-(--pv-muted)"
      aria-hidden="true"
    >
      <span class="flex items-center gap-1">
        <UIcon name="i-lucide-thumbs-up" class="size-3.5" />{{ t('posts.preview.like') }}
      </span>
      <span class="flex items-center gap-1">
        <UIcon name="i-lucide-message-circle" class="size-3.5" />{{ t('posts.preview.comment') }}
      </span>
      <span class="flex items-center gap-1">
        <UIcon name="i-lucide-share-2" class="size-3.5" />{{ t('posts.preview.share') }}
      </span>
    </div>
  </div>
</template>
