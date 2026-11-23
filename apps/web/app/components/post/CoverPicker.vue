<script setup lang="ts">
import type { MediaDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { frameAt, lastFrameMs, stepFrames } from '@app/domain'
import { fromMedia, type PostEditor } from '~/composables/usePostEditor'

/**
 * «Copertina» of a reel (D-60, Scelta 4; screen 09): the cover in 9:16 on the left; on the right
 * a strip of frames of the video with the cursor on the one chosen, from 0 to the last true
 * frame (the arrows one frame at a time, Maiusc+arrows a second); or an image, uploaded, dropped
 * or from the library (a video is refused at once, with the reason). «Ripristina» goes back to
 * the first frame. Under it, «Mostra anche nel feed» (§9.1). How the grid cuts the cover is in
 * the preview («Griglia»).
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
/** Feedway sends the cover to Instagram only: on Facebook the reel starts from its first frame. */
// the checks warn only while a Page of the post lacks the two permissions of the cover (D-120.9)
const onFacebook = computed(
  () => e.report.value?.outcomes.some((o) => o.code === 'cover_on_facebook') ?? false,
)
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
/** «Carica un'immagine»: from the computer or from the library. */
const uploadItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('posts.cover.fromComputer'),
    icon: 'i-lucide-upload',
    onSelect: () => input.value?.click(),
  },
  {
    label: t('posts.media.fromLibrary'),
    icon: 'i-lucide-images',
    onSelect: () => (picking.value = true),
  },
])
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
watch(offset, (ms) => {
  if (big.value) big.value.currentTime = ms / 1000
})
const seek = (event: Event) => {
  ;(event.target as HTMLVideoElement).currentTime = offset.value / 1000
}
/** The strip: eight frames spread over the video, each one in the middle of its eighth. */
const STRIP = 8
const stripAt = (i: number) => ((timing.value.durationMs / STRIP) * (i + 0.5)) / 1000
/** Where the cursor stands on the strip, from 0 to 1. */
const at = computed(() => (last.value > 0 ? offset.value / last.value : 0))
</script>

<template>
  <PostEditorRow heading="post-cover" :label="t('posts.cover.title')" data-cover>
    <div class="flex items-start gap-4">
      <div
        class="aspect-[9/16] w-[90px] shrink-0 overflow-hidden rounded-lg bg-black outline-1 -outline-offset-1 outline-(--app-img-outline) max-md:w-[72px]"
      >
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
      <div
        class="min-w-0 flex-1 rounded-lg"
        :class="dragging ? 'outline-2 outline-offset-4 outline-dashed outline-(--app-text)' : ''"
        data-cover-drop
        @dragover.prevent="dragging = e.editable.value"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <div
          class="relative rounded-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--app-focus)"
        >
          <div
            class="grid h-14 grid-cols-8 overflow-hidden rounded-md bg-(--app-surface-sunken) outline-1 -outline-offset-1 outline-(--app-img-outline)"
            aria-hidden="true"
          >
            <template v-if="videoSrc && !image">
              <video
                v-for="i in STRIP"
                :key="i"
                :src="`${videoSrc}#t=${stripAt(i - 1)}`"
                muted
                playsinline
                preload="metadata"
                class="size-full object-cover"
              />
            </template>
          </div>
          <input
            type="range"
            min="0"
            :max="last"
            step="1"
            :value="offset"
            :disabled="!e.editable.value || !video"
            :aria-label="t('posts.cover.chooseFrame')"
            :aria-valuetext="frameLabel"
            aria-describedby="post-cover-keys"
            class="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
            data-cover-frame
            @keydown="onKey"
            @input="onInput"
          />
          <span
            v-if="!image"
            class="pointer-events-none absolute -top-1 -bottom-1 w-9 rounded-lg border-3 border-(--app-text) shadow-[0_0_0_1px_var(--app-surface)]"
            :style="{ left: `calc(${at} * (100% - 2.25rem))` }"
            aria-hidden="true"
          />
          <span id="post-cover-keys" class="sr-only">{{ t('posts.cover.keys') }}</span>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="text-detail text-(--app-text-muted)" aria-live="polite" data-cover-state>
            {{
              image
                ? t('posts.cover.imageChosen')
                : t('posts.cover.frameShort', { time: clock(offset) })
            }}
          </span>
          <span class="flex-1" />
          <template v-if="e.editable.value">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              square
              icon="i-lucide-rotate-ccw"
              :aria-label="t('posts.cover.restore')"
              :title="t('posts.cover.restore')"
              :disabled="!image && offset === 0"
              @click="restore"
            />
            <UDropdownMenu :items="uploadItems" :content="{ align: 'end' }">
              <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-upload">
                {{ t('posts.cover.upload') }}
              </UButton>
            </UDropdownMenu>
          </template>
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
        <p v-if="onFacebook" class="mt-2 text-detail text-(--app-text-muted)" data-cover-facebook>
          {{ t('posts.cover.facebookFirstFrame') }}
        </p>
        <p v-if="uploading" role="status" class="mt-2 text-detail">
          {{ t('posts.cover.uploading', { name: uploading.name }) }}
        </p>
        <p v-if="problem" role="alert" class="mt-2 text-detail text-(--app-danger)">
          {{ problem }}
        </p>
      </div>
    </div>
    <USwitch
      :model-value="e.shareToFeed.value"
      :disabled="!e.editable.value"
      :label="t('posts.cover.shareToFeed')"
      :description="t('posts.cover.shareToFeedHelp')"
      class="mt-4"
      @update:model-value="(v: boolean) => e.setShareToFeed(v)"
    />
    <PostLibraryPicker
      v-if="e.editable.value"
      v-model:open="picking"
      :client="client"
      :exclude="[]"
      @pick="fromLibrary"
    />
  </PostEditorRow>
</template>
