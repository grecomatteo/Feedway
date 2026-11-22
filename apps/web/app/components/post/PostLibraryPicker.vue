<script setup lang="ts">
import type { MediaDto } from '@app/contracts'
import { META_LIMITS } from '@app/domain/platforms/meta'

/**
 * «Dalla libreria» (§11.2 point 3): the client's library in a window, to choose one or more
 * files, in the order they are ticked. The client's folders on the left (on a phone a menu with
 * the path back above the files, D-103), opened again on the folder used last for that client in
 * this browser; the search looks in the folder open, or in the whole client. «Carica» (when the
 * editor allows it) sends files from the computer into the folder open, and into the post.
 * With `max`, no more than that many can be ticked: a post has at most 10 files (D-118).
 */
const props = defineProps<{
  client: WorkspaceView
  exclude: string[]
  /** «Carica» from the computer: the editor uploads them into this folder and adds them */
  canUpload?: boolean
  /** how many files the post still takes; none means no limit here */
  max?: number
}>()
const emit = defineEmits<{ pick: [MediaDto[]]; upload: [File[], string | null] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const maxFiles = META_LIMITS.instagramCarouselMaxItems.value

const workspaceId = computed(() => props.client.id)
const lib = useLibrary(workspaceId, { lazy: true })
const { filter, folders } = lib
const chosen = ref<MediaDto[]>([])

// ---- the folder open, remembered for each client in this browser (D-103, choice 5 of D-109)
const KEY = 'feedway.picker-folder.'
function remembered(): string | null {
  try {
    return localStorage.getItem(KEY + props.client.id)
  } catch {
    return null
  }
}
function remember(place: string | null) {
  try {
    if (place) localStorage.setItem(KEY + props.client.id, place)
    else localStorage.removeItem(KEY + props.client.id)
  } catch {
    // a browser that keeps nothing opens on «Tutti i file» next time
  }
}
/** null: every file; `none`: the files in no folder; else a folder's id */
const place = ref<string | null>(null)
/** the search looks in the whole client, not only in the folder open */
const everywhere = ref(false)
const searching = computed(() => filter.q.trim() !== '')
watch([place, everywhere, searching], () => {
  const folder = everywhere.value && searching.value ? null : place.value
  if (filter.folder !== folder) filter.folder = folder
})
watch(place, (p) => {
  if (open.value) remember(p)
})
// a folder remembered that is not there any more: all the files
watch(folders, (list) => {
  const p = place.value
  if (p && p !== 'none' && lib.status.value === 'success' && !list.some((f) => f.id === p))
    place.value = null
})

watch(open, (now) => {
  if (!now) return
  chosen.value = []
  everywhere.value = false
  place.value = remembered()
  // one load: a change of folder or search already loads (useLibrary's watchers)
  const unchanged = filter.q === '' && filter.folder === place.value
  filter.q = ''
  filter.folder = place.value
  if (unchanged) void lib.load()
})

const tree = computed(() => folderTree(folders.value))
const folderById = (id: string | null) => folders.value.find((f) => f.id === id) ?? null
/** From the top to the folder open: the path back on a phone. */
const path = computed(() => {
  const out: { id: string; name: string }[] = []
  for (let f = folderById(place.value); f; f = folderById(f.parentId)) out.unshift(f)
  return out
})
const folderItems = computed(() => [
  { value: 'all', label: t('library.folders.all') },
  { value: 'none', label: t('library.folders.none') },
  ...tree.value.map((f) => ({ value: f.id, label: `${'— '.repeat(f.depth)}${f.name}` })),
])
const folderValue = computed({
  get: () => place.value ?? 'all',
  set: (v: string) => (place.value = v === 'all' ? null : v),
})
const placeName = computed(() =>
  place.value === null
    ? t('library.folders.all')
    : place.value === 'none'
      ? t('library.folders.none')
      : (folderById(place.value)?.name ?? ''),
)
const isHere = (target: string | null) => place.value === target
const rowClass =
  'flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left font-medium text-(--app-text-muted) transition-colors hover:bg-(--app-nav-hover) hover:text-(--app-text) aria-[current=true]:bg-(--app-nav-hover) aria-[current=true]:font-semibold aria-[current=true]:text-(--app-text) pointer-coarse:h-11'

const shown = computed(() =>
  lib.files.value.filter((f) => !props.exclude.includes(f.id) && f.status !== 'uploading'),
)
const isChosen = (f: MediaDto) => chosen.value.some((c) => c.id === f.id)
/** the files ticked fill what the post takes: the others wait until one is unticked */
const full = computed(() => props.max !== undefined && chosen.value.length >= props.max)
const left = computed(() =>
  props.max === undefined ? null : Math.max(0, props.max - chosen.value.length),
)
function toggle(f: MediaDto) {
  if (isChosen(f)) chosen.value = chosen.value.filter((c) => c.id !== f.id)
  else if (!full.value) chosen.value = [...chosen.value, f]
}
const thumb = (f: MediaDto) => {
  const variant = thumbnailOf(f)
  return variant ? lib.fileUrl(f, variant) : null
}
function done() {
  emit('pick', chosen.value)
}

// ---- «Carica»: into the folder open («Tutti i file» and «Senza cartella»: no folder)
const input = ref<HTMLInputElement | null>(null)
function uploaded(event: Event) {
  const el = event.target as HTMLInputElement
  const list = Array.from(el.files ?? [])
  el.value = ''
  if (list.length === 0) return
  // the files ticked are not lost: they go in first, then the ones sent
  if (chosen.value.length > 0) emit('pick', chosen.value)
  emit('upload', list, place.value && place.value !== 'none' ? place.value : null)
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('posts.library.title')"
    :description="$t('posts.library.text')"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="sm:grid sm:grid-cols-[12rem_1fr] sm:gap-5" data-picker>
        <!-- the client's folders: a column, on a phone a menu above the files -->
        <nav :aria-label="$t('library.folders.label')" class="max-sm:hidden" data-picker-folders>
          <ul class="space-y-0.5">
            <li>
              <button
                type="button"
                :class="rowClass"
                :aria-current="isHere(null) ? 'true' : undefined"
                @click="place = null"
              >
                <UIcon name="i-lucide-images" class="size-4 shrink-0" aria-hidden="true" />
                {{ $t('library.folders.all') }}
              </button>
            </li>
            <li>
              <button
                type="button"
                :class="rowClass"
                :aria-current="isHere('none') ? 'true' : undefined"
                @click="place = 'none'"
              >
                <UIcon name="i-lucide-inbox" class="size-4 shrink-0" aria-hidden="true" />
                {{ $t('library.folders.none') }}
              </button>
            </li>
            <li v-for="f in tree" :key="f.id">
              <button
                type="button"
                :class="rowClass"
                :style="{ paddingLeft: `${0.625 + f.depth * 0.875}rem` }"
                :aria-current="isHere(f.id) ? 'true' : undefined"
                :data-picker-folder="f.name"
                @click="place = f.id"
              >
                <UIcon
                  :name="isHere(f.id) ? 'i-lucide-folder-open' : 'i-lucide-folder'"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
              </button>
            </li>
          </ul>
        </nav>

        <div class="flex min-w-0 flex-col gap-4">
          <div class="flex flex-col gap-2 sm:hidden">
            <USelect
              v-model="folderValue"
              :items="folderItems"
              :aria-label="$t('library.folders.choose')"
              class="w-full"
              size="xl"
              icon="i-lucide-folder"
            />
            <nav
              v-if="path.length > 0"
              :aria-label="$t('posts.library.path')"
              class="flex flex-wrap items-center gap-1 text-sm"
              data-picker-path
            >
              <button
                type="button"
                class="min-h-11 rounded-control px-1 text-(--app-text-muted) underline-offset-2 hover:underline"
                @click="place = null"
              >
                {{ $t('library.folders.all') }}
              </button>
              <template v-for="(p, i) in path" :key="p.id">
                <UIcon
                  name="i-lucide-chevron-right"
                  class="size-3.5 text-(--app-text-muted)"
                  aria-hidden="true"
                />
                <span v-if="i === path.length - 1" aria-current="location" class="font-medium">{{
                  p.name
                }}</span>
                <button
                  v-else
                  type="button"
                  class="min-h-11 rounded-control px-1 text-(--app-text-muted) underline-offset-2 hover:underline"
                  @click="place = p.id"
                >
                  {{ p.name }}
                </button>
              </template>
            </nav>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <SearchField
              v-model="filter.q"
              :label="$t('posts.library.searchIn', { place: placeName })"
              class="min-w-48 flex-1"
            />
            <SegmentedFilter
              v-model="filter.kind"
              :label="$t('posts.library.kind')"
              :options="[
                { value: 'all', label: t('posts.library.all') },
                { value: 'image', label: t('posts.library.photos') },
                { value: 'video', label: t('posts.library.videos') },
              ]"
            />
            <UButton
              v-if="canUpload"
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              class="min-h-control"
              :disabled="full"
              @click="input?.click()"
            >
              {{ $t('library.upload') }}
            </UButton>
          </div>
          <UCheckbox
            v-if="searching && place !== null"
            v-model="everywhere"
            :ui="{ root: 'min-h-11 items-center' }"
            :label="$t('posts.library.everywhere', { client: client.name })"
            data-picker-everywhere
          />
          <p
            v-if="left !== null"
            class="text-sm text-(--app-text-muted)"
            aria-live="polite"
            data-picker-room
          >
            {{ $t('posts.library.room', { n: left, max: maxFiles }, left) }}
          </p>
          <ListSkeleton v-if="lib.status.value === 'pending' && shown.length === 0" />
          <p v-else-if="lib.status.value === 'error'" role="alert" class="text-(--app-danger)">
            {{ $t('posts.library.error') }}
          </p>
          <p v-else-if="shown.length === 0" class="text-(--app-text-muted)">
            {{ $t('posts.library.empty') }}
          </p>
          <ul
            v-else
            :aria-label="$t('posts.library.title')"
            class="grid grid-cols-3 gap-2 sm:grid-cols-4"
          >
            <li v-for="f in shown" :key="f.id">
              <button
                type="button"
                :aria-pressed="isChosen(f)"
                :aria-disabled="full && !isChosen(f) ? 'true' : undefined"
                :aria-label="f.originalName"
                class="relative block aspect-[4/5] w-full overflow-hidden rounded-lg border-2 bg-(--app-surface-sunken) aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                :class="isChosen(f) ? 'border-(--app-brand)' : 'border-transparent'"
                @click="toggle(f)"
              >
                <img v-if="thumb(f)" :src="thumb(f)!" alt="" class="size-full object-cover" />
                <UIcon
                  v-else
                  :name="f.kind === 'video' ? 'i-lucide-film' : 'i-lucide-image'"
                  class="size-6 text-(--app-text-muted)"
                  aria-hidden="true"
                />
                <span
                  v-if="isChosen(f)"
                  class="absolute top-1 left-1 flex size-6 items-center justify-center rounded-full bg-(--app-brand) text-xs font-semibold text-(--app-on-brand) tabular-nums"
                  aria-hidden="true"
                  >{{ chosen.findIndex((c) => c.id === f.id) + 1 }}</span
                >
              </button>
              <p class="mt-1 line-clamp-2 text-xs break-all" :title="f.originalName">
                {{ f.originalName }}
              </p>
            </li>
          </ul>
          <UButton
            v-if="lib.next.value"
            color="neutral"
            variant="outline"
            class="min-h-control self-start"
            :loading="lib.loadingMore.value"
            @click="lib.more()"
          >
            {{ $t('posts.library.more') }}
          </UButton>
        </div>
      </div>
      <input
        v-if="canUpload"
        ref="input"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov"
        class="hidden"
        data-picker-input
        @change="uploaded"
      />
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-3">
        <UButton color="neutral" variant="ghost" class="min-h-control" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
        <UButton class="min-h-control" :disabled="chosen.length === 0" @click="done">
          {{ $t('posts.library.add', { n: chosen.length }, chosen.length) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
