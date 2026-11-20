<script setup lang="ts">
import type { PreviewItem } from '~/utils/post-preview'

/**
 * «Griglia» (screens 08 and 09): the profile's grid with this post first, cut to 3:4 as Instagram
 * shows it since 2025, a carousel or reel sign in its corner. The other places stay empty: the
 * panel does not read the posts already out.
 */
defineProps<{
  name: string
  item: PreviewItem | undefined
  /** the sign in the corner */
  kind: 'carousel' | 'reel' | null
}>()
const { t } = useI18n()
const SIGN = { carousel: 'i-lucide-gallery-horizontal-end', reel: 'i-lucide-clapperboard' }
</script>

<template>
  <div class="flex flex-col" data-view="instagram_grid">
    <p class="px-3 py-2.5 text-[0.8125rem] font-semibold">{{ name }}</p>
    <ul class="grid grid-cols-3 gap-0.5" :aria-label="t('posts.preview.gridLabel')">
      <li class="relative aspect-[3/4] overflow-hidden" data-grid-first>
        <PostPreviewMedia v-if="item" :item="item" />
        <template v-if="kind">
          <UIcon
            :name="SIGN[kind]"
            class="absolute top-1.5 right-1.5 size-4 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
            aria-hidden="true"
          />
          <span class="sr-only">{{ t(`posts.preview.gridKind.${kind}`) }}</span>
        </template>
      </li>
      <li v-for="i in 8" :key="i" class="aspect-[3/4] bg-[#efefef]" aria-hidden="true" />
    </ul>
  </div>
</template>
