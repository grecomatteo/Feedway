<script setup lang="ts">
import type { MediaDto } from '@app/contracts'
import { frameAt, lastFrameMs, stepFrames } from '@app/domain'
import { fromMedia, type PostEditor } from '~/composables/usePostEditor'
import { centeredCrop, cropStyle } from '~/utils/post-preview'

/**
 * «Copertina del reel» (D-60, Scelta 4; design E5e): a frame of the video, from 0 to the last
 * true frame, with the arrows one frame at a time and Maiusc+arrows a second; or an image,
 * uploaded, dropped or from the library (a video is refused at once, with the reason); seen in
 * 9:16 and as the profile's grid cuts it (3:4, D-62). «Ripristina» goes back to the first
 * frame. Under it, «Mostra anche nel feed» (§9.1).
 */
const props = defineProps<{ editor: PostEditor; client: WorkspaceView }>()
const { t, n } = useI18n()
const e = props.editor

const video = computed(() => {
  const f = e.files.value[0]
  return f?.kind === 'video' ? f : undefined
})
const timing = computed(() => ({
  durationMs: video.value?.durationMs ?? 0,
  fps: video.value?.fps ?? 30,
}))
const last = computed(() => lastFrameMs(timing.value.durationMs, timing.value.fps))
const offset = computed(() => (e.cover.value?.source === 'frame' ? e.cover.value.offsetMs : 0))
const image = computed(() => (e.cover.value?.source === 'image' ? e.cover.value.mediaId : null))
const seconds = (ms: number) => n(ms / 1000, { maximumFractionDigits: 1 })
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`
}
const frameLabel = computed(() =>
  t('posts.cover.frameAt', {
    s: seconds(offset.value),
    frame: frameAt(offset.value, timing.value.fps) + 1,
    total: frameAt(last.value, timing.value.fps) + 1,
  }),
)

function setFrame(ms: number) {
  if (!e.editable.value) return
  e.setCover({ source: 'frame', offsetMs: Math.min(last.value, Math.max(0, Math.round(ms))) })
}
function onKey(event: KeyboardEvent) {
  const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key]
  if (by === undefined) return
  event.preventDefault()
  const frames = event.shiftKey ? Math.round(timing.value.fps) * by : by
  setFrame(stepFrames(offset.value, frames, timing.value))
}
function onInput(event: Event) {
  setFrame(Number((event.target as HTMLInputElement).value))
}

// ---- an image as the cover: only images, a video is refused at once (Scelta 4)
const problem = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)
const picking = ref(false)
const dragging = ref(false)
const isImage = (f: File) =>
  f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)
async function useFile(file: File | undefined) {
  problem.value = null
  if (!file) return
  if (!isImage(file)) {
    problem.value = t(
      file.type.startsWith('video/') ? 'posts.cover.onlyImages' : 'posts.cover.notImage',
      {
        name: file.name,
      },
    )
    return
  }
  const item = await e.uploadCover(file)
  if (item?.state === 'rejected') problem.value = item.message ?? t('posts.cover.failed')
}
function onPicked(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  void useFile(file)
}
function onDrop(event: DragEvent) {
  dragging.value = false
  void useFile(event.dataTransfer?.files[0])
}
function fromLibrary(list: MediaDto[]) {
  picking.value = false
  problem.value = null
  const first = list[0]
  if (!first) return
  if (first.kind !== 'image') {
    problem.value = t('posts.cover.onlyImages', { name: first.originalName })
    return
  }
  e.coverFile.value = fromMedia(first)
  e.setCover({ source: 'image', mediaId: first.id })
}
function restore() {
  problem.value = null
  e.coverUpload.value = null
  setFrame(0)
}
const uploading = computed(() => {
  const key = e.coverUpload.value
  return key ? e.uploads.items.value.find((i) => i.key === key) : undefined
})
// an upload that stops before the library has the file says so, and is no longer waited for
watch(
  () => uploading.value?.state,
  (state) => {
    const item = uploading.value
    if (!item || !state || !['failed', 'error', 'rejected'].includes(state)) return
    problem.value = item.message ?? t('posts.cover.failed')
    e.coverUpload.value = null
  },
)
watch(uploading, (item) => {
  // a cancelled upload leaves the list
  if (!item && e.coverUpload.value) e.coverUpload.value = null
})

// ---- what the cover looks like
const showFiles = computed(() => props.client.myRole !== 'viewer')
const videoSrc = computed(() =>
  video.value?.variants.includes('preview') && showFiles.value
    ? e.fileUrl(video.value.id, 'preview')
    : null,
)
const imageSrc = computed(() => (showFiles.value ? e.coverSrc.value : null))
const big = ref<HTMLVideoElement | null>(null)
const small = ref<HTMLVideoElement | null>(null)
watch(offset, (ms) => {
  for (const v of [big.value, small.value]) if (v) v.currentTime = ms / 1000
})
const seek = (event: Event) => {
  ;(event.target as HTMLVideoElement).currentTime = offset.value / 1000
}
/** The grid of the profile shows the middle 3:4 of the 9:16 cover (D-62). */
const grid = cropStyle(centeredCrop(3 / 4, 9, 16))
</script>

<template>
  <section aria-labelledby="post-cover" class="flex flex-col gap-4" data-cover>
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="post-cover" class="text-lg">{{ t('posts.cover.title') }}</h2>
      <p class="text-sm text-(--app-text-muted)" data-cover-state>
        {{
          image ? t('posts.cover.imageChosen') : t('posts.cover.frameShort', { s: seconds(offset) })
        }}
      </p>
    </div>
    <div class="flex flex-col gap-5 sm:flex-row">
      <div class="flex shrink-0 gap-3">
        <figure class="flex flex-col gap-1">
          <div class="relative aspect-[9/16] w-36 overflow-hidden rounded-lg bg-black">
            <img v-if="imageSrc" :src="imageSrc" alt="" class="size-full object-cover" />
            <video
              v-else-if="videoSrc"
              ref="big"
              :src="videoSrc"
              muted
              playsinline
              preload="auto"
              class="size-full object-cover"
              aria-hidden="true"
              @loadedmetadata="seek"
            />
          </div>
          <figcaption class="text-xs text-(--app-text-muted)">
            {{ t('posts.cover.reelTab') }}
          </figcaption>
        </figure>
        <figure class="flex flex-col gap-1 self-end">
          <div class="relative aspect-[3/4] w-20 overflow-hidden rounded-sm bg-black">
            <img v-if="imageSrc" :src="imageSrc" alt="" :style="grid" />
            <video
              v-else-if="videoSrc"
              ref="small"
              :src="videoSrc"
              muted
              playsinline
              preload="auto"
              :style="grid"
              aria-hidden="true"
              @loadedmetadata="seek"
            />
          </div>
          <figcaption class="text-xs text-(--app-text-muted)">
            {{ t('posts.cover.grid') }}
          </figcaption>
        </figure>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <label class="flex flex-col gap-2">
          <span class="text-sm font-semibold">{{ t('posts.cover.chooseFrame') }}</span>
          <input
            type="range"
            min="0"
            :max="last"
            step="1"
            :value="offset"
            :disabled="!e.editable.value || !video"
            :aria-valuetext="frameLabel"
            class="h-11 w-full accent-(--app-brand)"
            data-cover-frame
            @keydown="onKey"
            @input="onInput"
          />
        </label>
        <div class="flex justify-between text-xs text-(--app-text-muted) tabular-nums">
          <span>0:00</span>
          <span class="font-semibold text-(--app-text)" aria-live="polite">{{ frameLabel }}</span>
          <span>{{ clock(timing.durationMs) }}</span>
        </div>
        <p class="text-xs text-(--app-text-muted)">{{ t('posts.cover.keys') }}</p>
        <div
          class="flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed p-2"
          :class="dragging ? 'border-(--app-brand) bg-(--app-brand-soft)' : 'border-transparent'"
          data-cover-drop
          @dragover.prevent="dragging = e.editable.value"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-image-up"
            class="min-h-control"
            :disabled="!e.editable.value"
            @click="input?.click()"
          >
            {{ t('posts.cover.upload') }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-images"
            class="min-h-control"
            :disabled="!e.editable.value"
            @click="picking = true"
          >
            {{ t('posts.media.fromLibrary') }}
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-rotate-ccw"
            class="min-h-control"
            :disabled="!e.editable.value || (!image && offset === 0)"
            @click="restore"
          >
            {{ t('posts.cover.restore') }}
          </UButton>
          <input
            ref="input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            class="sr-only"
            tabindex="-1"
            aria-hidden="true"
            data-cover-file
            @change="onPicked"
          />
        </div>
        <p class="text-xs text-(--app-text-muted)">{{ t('posts.cover.rule') }}</p>
        <p v-if="uploading" role="status" class="text-sm">
          {{ t('posts.cover.uploading', { name: uploading.name }) }}
        </p>
        <p v-if="problem" role="alert" class="text-sm text-(--app-danger)">{{ problem }}</p>
      </div>
    </div>
    <USwitch
      :model-value="e.shareToFeed.value"
      :disabled="!e.editable.value"
      :label="t('posts.cover.shareToFeed')"
      :description="t('posts.cover.shareToFeedHelp')"
      class="min-h-11"
      @update:model-value="(v: boolean) => e.setShareToFeed(v)"
    />
    <PostLibraryPicker
      v-if="e.editable.value"
      v-model:open="picking"
      :client="client"
      :exclude="[]"
      @pick="fromLibrary"
    />
  </section>
</template>
