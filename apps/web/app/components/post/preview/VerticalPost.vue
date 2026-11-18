<script setup lang="ts">
import { SAFE_ZONES, type PreviewItem, type PreviewView } from '~/utils/post-preview'

/**
 * A reel or a story, on Instagram or on a Page (design E4): the file on black in its 9:16 frame,
 * the zones the app covers when asked (§11.3), and the app's names and buttons over both, so
 * they stay readable. A story has no text.
 */
const props = defineProps<{
  view: Extract<
    PreviewView,
    'instagram_reel' | 'facebook_reel' | 'instagram_story' | 'facebook_story'
  >
  name: string
  avatar: string | null
  item: PreviewItem | undefined
  caption: string
  zones: boolean
  /** a reel's video starts from its cover */
  startMs?: number
}>()
const { t } = useI18n()
const story = computed(() => props.view.endsWith('_story'))
const instagram = computed(() => props.view.startsWith('instagram'))
const zone = computed(() => SAFE_ZONES[story.value ? 'story' : 'reel'])
const pct = (n: number) => `${String(n * 100)}%`
</script>

<template>
  <div class="absolute inset-0 bg-black text-white" :data-view="view">
    <PostPreviewMedia v-if="item" :item="item" dark :start-ms="startMs" />
    <!-- the zones the app covers (design E4): crimson, see-through -->
    <div v-if="zones" class="pointer-events-none absolute inset-0 z-10" data-safe-zones>
      <div
        class="absolute inset-x-0 top-0 flex items-end justify-center border-b border-[#e0245e] bg-[#e0245e]/35 pb-1 text-[0.625rem] font-semibold"
        :style="{ height: pct(zone.top) }"
      >
        {{ t('posts.preview.covered') }}
      </div>
      <div
        class="absolute inset-x-0 bottom-0 flex items-start justify-center border-t border-[#e0245e] bg-[#e0245e]/35 pt-1 text-[0.625rem] font-semibold"
        :style="{ height: pct(zone.bottom) }"
      >
        {{ t('posts.preview.covered') }}
      </div>
      <div
        v-if="zone.sides > 0"
        class="absolute left-0 border-r border-[#e0245e] bg-[#e0245e]/35"
        :style="{ top: pct(zone.top), bottom: pct(zone.bottom), width: pct(zone.sides) }"
      />
      <div
        v-if="zone.sides > 0"
        class="absolute right-0 border-l border-[#e0245e] bg-[#e0245e]/35"
        :style="{ top: pct(zone.top), bottom: pct(zone.bottom), width: pct(zone.sides) }"
      />
    </div>
    <!-- the app around the file -->
    <div class="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between">
      <div class="flex flex-col gap-2 px-3 pt-3">
        <div v-if="story" class="h-0.5 w-full rounded bg-white/60" />
        <div class="flex items-center gap-2 text-[0.75rem] font-semibold">
          <template v-if="story">
            <span
              class="flex size-7 items-center justify-center overflow-hidden rounded-full bg-white/20 text-[0.5625rem]"
            >
              <img v-if="avatar" :src="avatar" alt="" class="size-full object-cover" />
              <template v-else>{{ name.slice(0, 2).toUpperCase() }}</template>
            </span>
            <span class="min-w-0 flex-1 truncate">
              {{ name }} <span class="font-normal opacity-70">{{ t('posts.preview.now') }}</span>
            </span>
            <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
          </template>
          <template v-else>
            <span class="flex-1 text-[0.9375rem]">
              {{ instagram ? t('posts.preview.reels') : t('posts.preview.reel') }}
            </span>
            <UIcon
              :name="instagram ? 'i-lucide-camera' : 'i-lucide-search'"
              class="size-4"
              aria-hidden="true"
            />
          </template>
        </div>
      </div>
      <div v-if="!story" class="flex items-end gap-2 px-3 pb-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1.5 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          <span class="flex items-center gap-2 text-[0.75rem] font-semibold">
            <span
              class="flex size-6 items-center justify-center overflow-hidden rounded-full bg-white/20 text-[0.5rem]"
            >
              <img v-if="avatar" :src="avatar" alt="" class="size-full object-cover" />
              <template v-else>{{ name.slice(0, 2).toUpperCase() }}</template>
            </span>
            <span class="truncate">{{ name }}</span>
            <span class="rounded-md border border-white/80 px-1.5 text-[0.625rem]">
              {{ t('posts.preview.follow') }}
            </span>
          </span>
          <div class="pointer-events-auto">
            <PostPreviewCaption
              v-if="caption"
              :text="caption"
              :limits="{ chars: 60, lines: 1 }"
              :more="t('posts.preview.more')"
              tone="light"
            />
          </div>
          <span class="flex min-w-0 items-center gap-1 text-[0.625rem] opacity-90">
            <UIcon name="i-lucide-music" class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t('posts.preview.audio', { name }) }}</span>
          </span>
        </div>
        <div class="flex flex-col items-center gap-3" aria-hidden="true">
          <UIcon name="i-lucide-heart" class="size-5" />
          <UIcon name="i-lucide-message-circle" class="size-5" />
          <UIcon name="i-lucide-send" class="size-5" />
          <UIcon name="i-lucide-ellipsis" class="size-5" />
        </div>
      </div>
      <div v-else class="flex items-center gap-2 px-3 pb-4" aria-hidden="true">
        <span
          class="flex-1 truncate rounded-full border border-white/70 px-3 py-1.5 text-[0.6875rem]"
        >
          {{
            instagram ? t('posts.preview.storyReply') : t('posts.preview.storyReplyTo', { name })
          }}
        </span>
        <UIcon name="i-lucide-heart" class="size-5" />
        <UIcon name="i-lucide-send" class="size-5" />
      </div>
    </div>
  </div>
</template>
