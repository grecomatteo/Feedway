<script setup lang="ts">
import type { MediaDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { EditorEntry, PostEditor } from '~/composables/usePostEditor'

/**
 * «File» (§11.2 point 3; screens 08 and 09): the files of the post in their order, as 96×120
 * tiles with their number and handle, the bar while they upload and their state; «Aggiungi» is
 * the last tile. The order changes by dragging the handle (mouse or touch) or with «Sposta
 * prima» and «Sposta dopo», shown under the tile that has the focus. Files come from «Carica»,
 * a drop, a paste or «Dalla libreria». No more than 10 (D-118): with 10 the ways to add are
 * off, and the files over them are left out and said.
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

/** A reel's only video (screen 09, B4): no «Aggiungi», but «Sostituisci» under the tile. */
const single = computed(
  () =>
    e.type.value === 'reel' && e.entries.value.length === 1 && e.kinds.value[0]?.kind === 'video',
)
/** the file picked or chosen next takes the video's place */
const replacing = ref(false)
/** a video not sent as MP4 is published from its MP4 copy (D-40) */
const converted = computed(() => {
  const name = e.entries.value[0]?.file?.name ?? ''
  return single.value && e.entries.value[0]?.file?.status === 'ready' && !/\.mp4$/i.test(name)
})

/** «38,8 MB · Convertito in MP4» beside «Sostituisci» (screen 09, D-98) */
const replaceNote = computed(() => {
  const size = e.entries.value[0]?.file?.sizeBytes
  return [
    single.value && size ? formatBytes(size) : null,
    converted.value ? t('posts.media.converted') : null,
  ]
    .filter(Boolean)
    .join(' · ')
})

function picked(event: Event) {
  const input = event.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  input.value = ''
  if (replacing.value) void e.replaceFiles(list)
  else void e.addFiles(list)
  replacing.value = false
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
/** «Carica» of «Dalla libreria»: into the folder open there, and into the post (D-103). */
function fromComputer(list: File[], folderId: string | null) {
  picking.value = false
  void e.addFiles(list, folderId)
}
function fromLibrary(list: MediaDto[]) {
  picking.value = false
  if (replacing.value) e.replaceFromLibrary(list)
  else e.addFromLibrary(list)
  replacing.value = false
}
const replaceItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('posts.media.upload'),
    icon: 'i-lucide-upload',
    onSelect: () => {
      replacing.value = true
      picker.value?.click()
    },
  },
  {
    label: t('posts.media.fromLibrary'),
    icon: 'i-lucide-images',
    onSelect: () => {
      replacing.value = true
      picking.value = true
    },
  },
])
defineExpose({
  choose: () => {
    replacing.value = false
    picker.value?.click()
  },
})
// a picker closed without a choice ends «Sostituisci»
watch(picking, (open) => {
  if (!open) replacing.value = false
})

const MAX = e.maxFiles
/** the post has all the files it can take */
const full = computed(() => e.room.value === 0)
/** Under the label: «2 di 10», «11 file, al massimo 10», or «1 video» for a reel's only file. */
const detail = computed(() => {
  const n = e.entries.value.length
  if (n === 0) return null
  if (n === 1 && e.kinds.value[0]?.kind === 'video') return t('posts.media.oneVideo')
  return t(n > MAX ? 'posts.media.detailOver' : 'posts.media.detail', { n, max: MAX })
})
const addItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('posts.media.upload'),
    icon: 'i-lucide-upload',
    onSelect: () => {
      replacing.value = false
      picker.value?.click()
    },
  },
  {
    label: t('posts.media.fromLibrary'),
    icon: 'i-lucide-images',
    onSelect: () => {
      replacing.value = false
      picking.value = true
    },
  },
])
const clock = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`
}

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
  <PostEditorRow heading="post-media" :label="$t('posts.media.title')" :detail="detail">
    <p class="sr-only" aria-live="polite">{{ said }}</p>
    <div
      class="flex flex-wrap gap-2.5 max-md:-mx-gutter max-md:flex-nowrap max-md:overflow-x-auto max-md:px-gutter"
      data-drop
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
          class="flex w-24 shrink-0 flex-col"
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
            class="relative h-30 w-24 overflow-hidden rounded-lg bg-(--app-surface-sunken) outline-1 -outline-offset-1 outline-(--app-img-outline) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-focus)"
            :class="[
              dragging === entry.key ? 'opacity-60' : '',
              dropAt === index && dragging !== entry.key
                ? 'ring-2 ring-(--app-text) ring-offset-2 ring-offset-(--app-bg)'
                : '',
            ]"
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
              v-if="e.entries.value.length > 1"
              class="absolute top-1.5 left-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-black/70 px-1 text-xs font-semibold text-white tabular-nums"
              aria-hidden="true"
              >{{ index + 1 }}</span
            >
            <span
              v-if="entry.file?.kind === 'video' && entry.file.durationMs"
              class="absolute bottom-1.5 left-1.5 flex h-5 items-center gap-1 rounded-md bg-black/70 px-1.5 text-xs font-semibold text-white tabular-nums"
              aria-hidden="true"
            >
              <UIcon name="i-lucide-clapperboard" class="size-3" />{{
                clock(entry.file.durationMs)
              }}</span
            >
            <button
              v-if="e.editable.value && e.entries.value.length > 1"
              type="button"
              class="absolute top-0.5 right-0.5 flex size-7 cursor-grab touch-none items-center justify-center"
              :aria-label="$t('posts.media.dragFor', { name: nameOf(entry) })"
              tabindex="-1"
              @pointerdown.prevent="grab(entry, $event)"
            >
              <span
                class="flex size-5 items-center justify-center rounded-md bg-black/70 text-white"
              >
                <UIcon name="i-lucide-grip-vertical" class="size-[13px]" aria-hidden="true" />
              </span>
            </button>
            <div
              v-if="e.uploadItem(entry) && !entry.file && showsBar(e.uploadItem(entry)!)"
              class="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-(--app-surface)"
              aria-hidden="true"
            >
              <div
                class="h-full bg-(--app-text)"
                :style="{ width: `${barPercent(e.uploadItem(entry)!)}%` }"
              />
            </div>
          </div>
          <p class="mt-1.5 truncate text-xs text-(--app-text-muted)" :title="nameOf(entry)">
            {{ nameOf(entry) }}
          </p>
          <p v-if="stateOf(entry)" class="text-xs" :class="stateOf(entry)?.tone">
            {{ stateOf(entry)?.text }}
          </p>
          <div v-if="e.editable.value && focused === entry.key" class="mt-1 flex gap-0.5">
            <UButton
              v-if="e.entries.value.length > 1"
              color="neutral"
              variant="outline"
              size="sm"
              square
              icon="i-lucide-arrow-left"
              :disabled="index === 0"
              :aria-label="$t('posts.media.earlier', { name: nameOf(entry) })"
              @click="move(entry, -1, index)"
            />
            <UButton
              v-if="e.entries.value.length > 1"
              color="neutral"
              variant="outline"
              size="sm"
              square
              icon="i-lucide-arrow-right"
              :disabled="index === e.entries.value.length - 1"
              :aria-label="$t('posts.media.later', { name: nameOf(entry) })"
              @click="move(entry, 1, index)"
            />
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              square
              icon="i-lucide-x"
              :aria-label="$t('posts.media.remove', { name: nameOf(entry) })"
              @click="removeOne(entry)"
            />
          </div>
        </li>
      </ol>
      <UDropdownMenu
        v-if="e.editable.value && !single"
        :items="addItems"
        :content="{ align: 'start' }"
        :disabled="full"
      >
        <button
          type="button"
          :disabled="full"
          :aria-describedby="full ? 'post-media-full' : undefined"
          class="flex h-30 w-24 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed text-xs text-(--app-text-muted) not-disabled:hover:text-(--app-text) disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            dragOver
              ? 'border-(--app-text) bg-(--app-surface-sunken)'
              : 'border-(--app-border-strong)'
          "
          :aria-label="$t('posts.media.addLabel')"
          data-add-file
        >
          <UIcon name="i-lucide-plus" class="size-5" aria-hidden="true" />
          {{ $t('posts.media.add') }}
        </button>
      </UDropdownMenu>
    </div>
    <div v-if="e.editable.value && single" class="mt-2.5 flex flex-wrap items-center gap-2">
      <UDropdownMenu :items="replaceItems" :content="{ align: 'start' }">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          :aria-label="$t('posts.media.replaceLabel')"
          data-replace-file
        >
          {{ $t('posts.media.replace') }}
        </UButton>
      </UDropdownMenu>
      <span v-if="replaceNote" class="text-detail text-(--app-text-muted)" data-replace-note>{{
        replaceNote
      }}</span>
    </div>
    <div
      v-else-if="e.editable.value"
      class="mt-2.5 flex flex-wrap items-center gap-2 max-md:hidden"
    >
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-upload"
        :disabled="full"
        @click="((replacing = false), picker?.click())"
      >
        {{ $t('posts.media.upload') }}
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-images"
        :disabled="full"
        @click="((replacing = false), (picking = true))"
      >
        {{ $t('posts.media.fromLibrary') }}
      </UButton>
      <span v-if="!full" class="text-detail text-(--app-text-muted)">{{
        $t('posts.media.dropHere')
      }}</span>
    </div>
    <p
      v-if="e.editable.value && full && !single"
      id="post-media-full"
      class="mt-2 text-sm text-(--app-text-muted)"
      data-media-full
    >
      {{
        $t(e.entries.value.length > MAX ? 'posts.media.over' : 'posts.media.full', {
          n: e.entries.value.length,
          max: MAX,
        })
      }}
    </p>
    <input
      v-if="e.editable.value"
      ref="picker"
      type="file"
      multiple
      :accept="
        replacing
          ? 'video/mp4,video/quicktime,.mov'
          : 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov'
      "
      class="hidden"
      data-post-input
      @change="picked"
    />
    <!-- the alert around the list: on the <ul> itself the role would hide the list -->
    <div v-if="e.refused.value.length > 0 || e.leftOut.value > 0" role="alert">
      <ul class="mt-2 flex flex-col gap-1">
        <li v-if="e.leftOut.value > 0" class="text-sm text-(--app-danger)" data-media-left-out>
          {{ $t('posts.media.leftOut', { n: e.leftOut.value, max: MAX }, e.leftOut.value) }}
        </li>
        <li v-for="r in e.refused.value" :key="r.key" class="text-sm text-(--app-danger)">
          {{ r.name }}: {{ r.message }}
        </li>
      </ul>
    </div>
    <PostLibraryPicker
      v-if="e.editable.value"
      v-model:open="picking"
      :client="client"
      :exclude="e.files.value.map((f) => f.id)"
      :can-upload="!replacing"
      :max="replacing ? undefined : e.room.value"
      @pick="fromLibrary"
      @upload="fromComputer"
    />
  </PostEditorRow>
</template>
