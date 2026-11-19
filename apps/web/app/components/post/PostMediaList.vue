<script setup lang="ts">
import type { MediaDto } from '@app/contracts'
import type { EditorEntry, PostEditor } from '~/composables/usePostEditor'

/**
 * «File» (§11.2 point 3; design E1, E6b, E6c): the files of the post in their order, as 4:5
 * tiles with their number, the bar while they upload and their state. The order changes by
 * dragging the handle (mouse or touch) or with «Sposta prima» and «Sposta dopo». Files come
 * from «Carica», a drop, a paste or «Dalla libreria».
 */
const props = defineProps<{ editor: PostEditor; client: WorkspaceView }>()
const { t } = useI18n()
const e = props.editor
const { line, tone, showsBar, barPercent } = useUploadLine()

const picker = ref<HTMLInputElement | null>(null)
const picking = ref(false)
const focused = ref<string | null>(null)
const dragOver = ref(false)
const said = ref('')

function picked(event: Event) {
  const input = event.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  input.value = ''
  void e.addFiles(list)
}
function dropped(event: DragEvent) {
  dragOver.value = false
  const list = Array.from(event.dataTransfer?.files ?? [])
  if (list.length > 0) void e.addFiles(list)
}
function pasted(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [contenteditable="true"]')) return
  const list = Array.from(event.clipboardData?.files ?? [])
  if (list.length === 0) return
  event.preventDefault()
  const now = new Date()
  void e.addFiles(
    list.map((f) =>
      f.name && f.name !== 'image.png'
        ? f
        : new File([f], pastedFileName(f.type, now), { type: f.type, lastModified: now.getTime() }),
    ),
  )
}
onMounted(() => document.addEventListener('paste', pasted))
onBeforeUnmount(() => document.removeEventListener('paste', pasted))
function fromLibrary(list: MediaDto[]) {
  picking.value = false
  e.addFromLibrary(list)
}
defineExpose({ choose: () => picker.value?.click() })

const nameOf = (entry: EditorEntry) =>
  entry.file?.name ?? e.uploadItem(entry)?.name ?? t('posts.media.unnamed')
const thumbOf = (entry: EditorEntry) => {
  const f = entry.file
  // the copies are read from the library, Editor and up: the Viewer sees the tiles without (D-72)
  if (props.client.myRole === 'viewer') return null
  if (f && f.status !== 'deleted') {
    const variant = f.variants.includes('thumbnail')
      ? 'thumbnail'
      : f.kind === 'image' && f.variants.includes('ig_feed')
        ? 'ig_feed'
        : null
    if (variant) return { url: e.fileUrl(f.id, variant), video: false }
  }
  const preview = e.uploadItem(entry)?.preview
  return preview ? { url: preview.url, video: preview.kind === 'video' } : null
}
/** What the tile says under the name: the upload, or the state of the file. */
function stateOf(entry: EditorEntry): { text: string; tone: string } | null {
  const item = e.uploadItem(entry)
  if (item && !entry.file) return { text: line(item), tone: tone(item) }
  const f = entry.file
  if (!f || f.status === 'ready') return null
  if (f.status === 'deleted') return { text: t('posts.media.deleted'), tone: 'text-(--app-danger)' }
  if (f.status === 'failed') return { text: t('upload.state.failed'), tone: 'text-(--app-danger)' }
  return { text: t('upload.state.processing'), tone: 'text-(--app-text-muted)' }
}

function move(entry: EditorEntry, by: -1 | 1, index: number) {
  e.move(entry.key, by)
  said.value = t('posts.media.moved', { name: nameOf(entry), n: index + 1 + by })
  void nextTick(() => document.querySelector<HTMLElement>(`[data-entry="${entry.key}"]`)?.focus())
}
function removeOne(entry: EditorEntry) {
  said.value = t('posts.media.removed', { name: nameOf(entry) })
  e.removeEntry(entry.key)
}

// dragging the handle, with the pointer (mouse and touch alike)
const dragging = ref<string | null>(null)
const dropAt = ref<number | null>(null)
function grab(entry: EditorEntry, event: PointerEvent) {
  if (!e.editable.value) return
  dragging.value = entry.key
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function drag(event: PointerEvent) {
  if (!dragging.value) return
  const under = document.elementFromPoint(event.clientX, event.clientY)
  const tile = under?.closest<HTMLElement>('[data-index]')
  if (tile) dropAt.value = Number(tile.dataset.index)
}
function release() {
  if (dragging.value !== null && dropAt.value !== null) e.moveTo(dragging.value, dropAt.value)
  dragging.value = null
  dropAt.value = null
}
</script>

<template>
  <section aria-labelledby="post-media" class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="post-media" class="text-lg">{{ $t('posts.media.title') }}</h2>
      <p v-if="e.entries.value.length > 1" class="text-sm text-(--app-text-muted)">
        {{ $t('posts.media.count', { n: e.entries.value.length }, e.entries.value.length) }}
      </p>
    </div>
    <p class="sr-only" aria-live="polite">{{ said }}</p>
    <div
      class="flex flex-wrap gap-3"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="dropped"
    >
      <ol
        v-if="e.entries.value.length > 0"
        :aria-label="$t('posts.media.title')"
        class="contents"
        @pointermove="drag"
        @pointerup="release"
        @pointercancel="release"
      >
        <li
          v-for="(entry, index) in e.entries.value"
          :key="entry.key"
          :data-index="index"
          class="flex w-32 flex-col gap-1"
          :class="
            dropAt === index && dragging !== entry.key
              ? 'outline-2 outline-(--app-brand) outline-offset-2 rounded-lg'
              : ''
          "
          @focusin="focused = entry.key"
        >
          <div
            :data-entry="entry.key"
            role="group"
            tabindex="0"
            :aria-label="
              $t('posts.media.tile', { n: index + 1, name: nameOf(entry) }) +
              (stateOf(entry) ? ` · ${stateOf(entry)?.text}` : '')
            "
            class="relative h-40 w-32 overflow-hidden rounded-lg border border-(--app-border) bg-(--app-surface-sunken) focus-visible:outline-2 focus-visible:outline-(--app-brand)"
            :class="dragging === entry.key ? 'opacity-60' : ''"
          >
            <template v-if="thumbOf(entry)">
              <video
                v-if="thumbOf(entry)?.video"
                :src="thumbOf(entry)?.url"
                muted
                playsinline
                preload="metadata"
                class="size-full object-cover"
              />
              <img v-else :src="thumbOf(entry)?.url" alt="" class="size-full object-cover" />
            </template>
            <span
              v-else
              class="flex size-full items-center justify-center text-(--app-text-muted)"
              aria-hidden="true"
            >
              <UIcon
                :name="e.kinds.value[index]?.kind === 'video' ? 'i-lucide-film' : 'i-lucide-image'"
                class="size-6"
              />
            </span>
            <span
              class="absolute top-2 left-2 flex size-6 items-center justify-center rounded-full bg-(--app-surface) text-xs font-semibold tabular-nums"
              aria-hidden="true"
              >{{ index + 1 }}</span
            >
            <button
              v-if="e.editable.value && e.entries.value.length > 1"
              type="button"
              class="absolute top-1 right-1 flex size-8 cursor-grab touch-none items-center justify-center rounded-md bg-(--app-surface)"
              :aria-label="$t('posts.media.dragFor', { name: nameOf(entry) })"
              tabindex="-1"
              @pointerdown.prevent="grab(entry, $event)"
            >
              <UIcon name="i-lucide-grip" class="size-4" aria-hidden="true" />
            </button>
            <div
              v-if="e.uploadItem(entry) && !entry.file && showsBar(e.uploadItem(entry)!)"
              class="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-(--app-surface)"
              aria-hidden="true"
            >
              <div
                class="h-full bg-(--app-brand)"
                :style="{ width: `${barPercent(e.uploadItem(entry)!)}%` }"
              />
            </div>
          </div>
          <p class="line-clamp-2 text-xs break-all" :title="nameOf(entry)">{{ nameOf(entry) }}</p>
          <p v-if="stateOf(entry)" class="text-xs" :class="stateOf(entry)?.tone">
            {{ stateOf(entry)?.text }}
          </p>
          <div
            v-if="e.editable.value && (focused === entry.key || e.entries.value.length === 1)"
            class="flex gap-1"
          >
            <UButton
              v-if="e.entries.value.length > 1"
              color="neutral"
              variant="outline"
              class="size-10 justify-center max-sm:size-11"
              icon="i-lucide-arrow-left"
              :disabled="index === 0"
              :aria-label="$t('posts.media.earlier', { name: nameOf(entry) })"
              @click="move(entry, -1, index)"
            />
            <UButton
              v-if="e.entries.value.length > 1"
              color="neutral"
              variant="outline"
              class="size-10 justify-center max-sm:size-11"
              icon="i-lucide-arrow-right"
              :disabled="index === e.entries.value.length - 1"
              :aria-label="$t('posts.media.later', { name: nameOf(entry) })"
              @click="move(entry, 1, index)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="size-10 justify-center max-sm:size-11"
              icon="i-lucide-x"
              :aria-label="$t('posts.media.remove', { name: nameOf(entry) })"
              @click="removeOne(entry)"
            />
          </div>
        </li>
      </ol>
      <div
        v-if="e.editable.value"
        class="flex min-h-40 flex-1 basis-56 flex-col items-stretch justify-center gap-2 rounded-lg border border-dashed p-4"
        :class="dragOver ? 'border-(--app-brand) bg-(--app-brand-soft)' : 'border-(--app-border)'"
      >
        <p class="text-center text-sm text-(--app-text-muted)">{{ $t('posts.media.dropHere') }}</p>
        <UButton
          color="neutral"
          variant="outline"
          class="min-h-control justify-center"
          icon="i-lucide-upload"
          @click="picker?.click()"
        >
          {{ $t('posts.media.upload') }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          class="min-h-control justify-center"
          icon="i-lucide-images"
          @click="picking = true"
        >
          {{ $t('posts.media.fromLibrary') }}
        </UButton>
        <input
          ref="picker"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov"
          class="hidden"
          data-post-input
          @change="picked"
        />
      </div>
    </div>
    <ul v-if="e.refused.value.length > 0" class="flex flex-col gap-1" role="alert">
      <li v-for="r in e.refused.value" :key="r.key" class="text-sm text-(--app-danger)">
        {{ r.name }}: {{ r.message }}
      </li>
    </ul>
    <PostLibraryPicker
      v-if="e.editable.value"
      v-model:open="picking"
      :client="client"
      :exclude="e.files.value.map((f) => f.id)"
      @pick="fromLibrary"
    />
  </section>
</template>
