<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Folder, LibraryFile } from '~/composables/useLibrary'
import { THUMB_SIZES } from '~/composables/useLibraryView'

/**
 * The library of one client (spec §11.8, plan 04 Task 12; brief F03): folders on the left (a
 * menu on a phone), filters by type, tag and name, a grid of files by pages, the detail on the
 * side. A file moves into a folder by dragging it there or with «Sposta in…». Used by
 * `/<agenzia>/libreria` and by the client's «Libreria» tab. An archived client is read only.
 */
const props = defineProps<{
  workspace: WorkspaceView
  /** the page puts «Carica file» in its head (`chooseFiles`) */
  uploadInHeader?: boolean
}>()
const { t } = useI18n()
const { failure } = useApi()
const ready = useHydrated()

const workspaceId = computed(() => props.workspace.id)
const lib = useLibrary(workspaceId)
const { filter, files, folders, status } = lib
const readOnly = computed(() => props.workspace.archivedAt !== null)

const tree = computed(() => folderTree(folders.value))
const folderById = (id: string | null) => folders.value.find((f) => f.id === id) ?? null
const current = computed(() =>
  filter.folder && filter.folder !== 'none' ? folderById(filter.folder) : null,
)
const subfoldersOf = (id: string) => folders.value.filter((f) => f.parentId === id)
/** What deleting a folder takes with it: the folders below it and every file in the lot. */
const contentOf = (folder: Folder) => {
  const below = foldersBelow(folders.value, folder.id)
  const files = [folder, ...below].reduce((n, f) => n + f.fileCount, 0)
  return { files, folders: below.length }
}
const filtering = computed(
  () => filter.kind !== 'all' || filter.tag !== null || filter.q.trim() !== '',
)

const done = useFlash()
const problem = ref<string | null>(null)
function say(message: string) {
  problem.value = null
  done.value = message
}
async function attempt(action: () => Promise<unknown>) {
  done.value = null
  problem.value = null
  try {
    await action()
    return true
  } catch (e) {
    problem.value = failure(e).message
    return false
  }
}

const emit = defineEmits<{ usage: [bytes: number] }>()
watch(lib.usedBytes, (b) => emit('usage', b), { immediate: true })

// ---- filters
const kindOptions = computed(() => [
  { value: 'all' as const, label: t('library.kind.all') },
  { value: 'image' as const, label: t('library.kind.image') },
  { value: 'video' as const, label: t('library.kind.video') },
])
const tagItems = computed(() => [
  { value: '*', label: t('library.tag.all') },
  ...lib.tags.value.map((tag) => ({ value: tag, label: `#${tag}` })),
])
const tagValue = computed({
  get: () => filter.tag ?? '*',
  set: (v: string) => (filter.tag = v === '*' ? null : v),
})
const folderItems = computed(() => [
  { value: 'all', label: t('library.folders.all') },
  { value: 'none', label: t('library.folders.none') },
  ...tree.value.map((f) => ({ value: f.id, label: `${'— '.repeat(f.depth)}${f.name}` })),
])
const folderValue = computed({
  get: () => filter.folder ?? 'all',
  set: (v: string) => (filter.folder = v === 'all' ? null : v),
})
// ---- grid or list, and the size of the thumbnails (E-1)
const { view, columns } = useLibraryView()
const layoutOptions = computed(() => [
  { value: 'grid' as const, icon: 'i-lucide-layout-grid', label: t('library.view.grid') },
  { value: 'list' as const, icon: 'i-lucide-list', label: t('library.view.list') },
])
const sizeText = computed(() => t(`library.view.sizes.${view.size}`))
const gridStyle = computed(() =>
  view.layout === 'grid' ? { gridTemplateColumns: columns.value } : undefined,
)

function clearFilters() {
  Object.assign(filter, { kind: 'all', tag: null, q: '' })
}

// ---- the detail
const selected = ref<LibraryFile | null>(null)
const detailOpen = computed({
  get: () => selected.value !== null,
  set: (v) => {
    if (!v) selected.value = null
  },
})
const thumb = (f: LibraryFile) => {
  const variant = thumbnailOf(f)
  return variant ? lib.fileUrl(f, variant) : null
}

// ---- move, by dragging or with «Sposta in…»
const folderLabel = (id: string | null) => folderById(id)?.name ?? t('library.folders.none')
async function move(file: LibraryFile, folderId: string | null) {
  if (file.folderId === folderId) return
  const ok = await attempt(async () => {
    const updated = await lib.update(file, { folderId })
    if (selected.value?.id === file.id) selected.value = updated
  })
  if (ok)
    say(
      folderId === null
        ? t('library.movedOut', { name: file.originalName })
        : t('library.moved', { name: file.originalName, folder: folderLabel(folderId) }),
    )
}
// the tags are saved one request at a time, the latest list last: answers never cross
let pendingTags: { file: LibraryFile; tags: string[] } | null = null
let savingTags = false
async function saveTags(file: LibraryFile, tags: string[]) {
  pendingTags = { file, tags }
  if (savingTags) return
  savingTags = true
  try {
    while (pendingTags) {
      const job: { file: LibraryFile; tags: string[] } = pendingTags
      pendingTags = null
      const ok = await attempt(async () => {
        const updated = await lib.update(job.file, { tags: job.tags })
        if (selected.value?.id === job.file.id) selected.value = updated
      })
      if (!ok) {
        // what is shown goes back to what is saved
        pendingTags = null
        const saved = files.value.find((f) => f.id === job.file.id) ?? job.file
        if (selected.value?.id === job.file.id)
          selected.value = { ...selected.value, tags: [...saved.tags] }
        return
      }
    }
    say(t('library.detail.tagsSaved'))
  } finally {
    savingTags = false
  }
}
async function showMore() {
  if (!(await lib.more())) problem.value = t('library.loadError')
}
const moving = ref<LibraryFile | null>(null)
const moveTarget = ref('none')
const moveOpen = computed({
  get: () => moving.value !== null,
  set: (v) => {
    if (!v) moving.value = null
  },
})
const moveItems = computed(() => folderItems.value.filter((i) => i.value !== 'all'))
function startMove(file: LibraryFile) {
  moving.value = file
  moveTarget.value = file.folderId ?? 'none'
}
async function confirmMove() {
  const file = moving.value
  if (!file) return
  moving.value = null
  await move(file, moveTarget.value === 'none' ? null : moveTarget.value)
}

const dropOn = ref<string | null>(null)
const DRAG_TYPE = 'application/x-feedway-media'
function dragOver(event: DragEvent, target: string) {
  if (readOnly.value || !event.dataTransfer?.types.includes(DRAG_TYPE)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropOn.value = target
}
async function drop(event: DragEvent, target: string) {
  dropOn.value = null
  const id = event.dataTransfer?.getData(DRAG_TYPE)
  const file = files.value.find((f) => f.id === id)
  if (!file || readOnly.value) return
  event.preventDefault()
  await move(file, target === 'none' ? null : target)
}

// ---- delete a file
const deleting = ref<LibraryFile | null>(null)
const deleteOpen = computed({
  get: () => deleting.value !== null,
  set: (v) => {
    if (!v) deleting.value = null
  },
})
async function confirmDelete() {
  const file = deleting.value
  if (!file) return
  deleting.value = null
  if (selected.value?.id === file.id) selected.value = null
  if (await attempt(() => lib.remove(file))) say(t('library.deleted', { name: file.originalName }))
}

function fileActions(file: LibraryFile): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = [
    [
      {
        label: t('library.open'),
        icon: 'i-lucide-panel-right-open',
        onSelect: () => (selected.value = file),
      },
    ],
  ]
  if (!readOnly.value) {
    groups[0]?.push({
      label: t('library.moveTo'),
      icon: 'i-lucide-folder-input',
      onSelect: () => startMove(file),
    })
    groups.push([
      {
        label: t('library.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        onSelect: () => (deleting.value = file),
      },
    ])
  }
  return groups
}

// ---- folders: create, rename, delete
const naming = ref<
  { mode: 'create'; parentId: string | null } | { mode: 'rename'; folder: Folder } | null
>(null)
const folderName = ref('')
const nameProblem = ref<string | null>(null)
const nameOpen = computed({
  get: () => naming.value !== null,
  set: (v) => {
    if (!v) naming.value = null
  },
})
const nameTitle = computed(() => {
  const n = naming.value
  if (!n) return ''
  if (n.mode === 'rename') return t('library.folders.renameTitle', { name: n.folder.name })
  const parent = folderById(n.parentId)
  return parent ? t('library.folders.newInside', { name: parent.name }) : t('library.folders.new')
})
function startCreate(parentId: string | null) {
  naming.value = { mode: 'create', parentId }
  folderName.value = ''
  nameProblem.value = null
}
function startRename(folder: Folder) {
  naming.value = { mode: 'rename', folder }
  folderName.value = folder.name
  nameProblem.value = null
}
async function saveName() {
  const n = naming.value
  if (!n) return
  try {
    if (n.mode === 'create') {
      const created = await lib.createFolder(folderName.value, n.parentId)
      say(t('library.folders.created', { name: created.name }))
    } else {
      await lib.renameFolder(n.folder, folderName.value)
      say(t('library.folders.renamed'))
    }
    naming.value = null
  } catch (e) {
    nameProblem.value = failure(e).message
  }
}
const removingFolder = ref<Folder | null>(null)
const removeFolderOpen = computed({
  get: () => removingFolder.value !== null,
  set: (v) => {
    if (!v) removingFolder.value = null
  },
})
const removingContent = computed(() => removingFolder.value && contentOf(removingFolder.value))
const removingFull = computed(
  () => !!removingContent.value && removingContent.value.files + removingContent.value.folders > 0,
)
const removingDescription = computed(() => {
  const c = removingContent.value
  if (!c || !removingFull.value) return t('library.folders.deleteEmpty')
  const what = [
    c.files > 0 ? t('library.folders.files', { n: c.files }, c.files) : null,
    c.folders > 0 ? t('library.folders.subfolders', { n: c.folders }, c.folders) : null,
  ]
    .filter(Boolean)
    .join(` ${t('library.folders.and')} `)
  return `${t('library.folders.deleteFull', { what })} ${t('library.folders.deleteForever')}`
})
async function confirmRemoveFolder() {
  const folder = removingFolder.value
  if (!folder) return
  removingFolder.value = null
  if (await attempt(() => lib.deleteFolder(folder))) say(t('library.folders.deleted'))
}
function folderActions(folder: Folder): DropdownMenuItem[][] {
  return [
    [
      {
        label: t('library.folders.newInside', { name: folder.name }),
        icon: 'i-lucide-folder-plus',
        onSelect: () => startCreate(folder.id),
      },
      {
        label: t('library.folders.rename'),
        icon: 'i-lucide-pencil',
        onSelect: () => startRename(folder),
      },
    ],
    [
      {
        label: t('library.folders.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        onSelect: () => (removingFolder.value = folder),
      },
    ],
  ]
}
const folderClass = (target: string) => [
  'flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors',
  dropOn.value === target
    ? 'bg-(--app-brand-soft) ring-2 ring-(--app-brand) ring-inset'
    : 'hover:bg-(--app-surface-sunken)',
]
const isCurrent = (target: string | null) => (filter.folder ?? null) === target

// ---- upload (plan 04 Task 13): into the folder shown, by button, drop or paste
const uploader = ref<{
  choose: () => void
  add: (files: readonly File[]) => void
  limitsText: string
} | null>(null)
const uploadFolder = computed(() =>
  filter.folder && filter.folder !== 'none' ? filter.folder : null,
)
function chooseFiles() {
  uploader.value?.choose()
}
defineExpose({ chooseFiles })
// files from the computer, not a file of the grid dragged onto a folder
const dropping = ref(false)
let depth = 0
const carriesFiles = (event: DragEvent) =>
  !readOnly.value &&
  !!event.dataTransfer?.types.includes('Files') &&
  !event.dataTransfer.types.includes(DRAG_TYPE)
function filesEnter(event: DragEvent) {
  if (!carriesFiles(event)) return
  event.preventDefault()
  depth += 1
  dropping.value = true
}
function filesOver(event: DragEvent) {
  if (!carriesFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function filesLeave(event: DragEvent) {
  if (!carriesFiles(event)) return
  depth = Math.max(0, depth - 1)
  if (depth === 0) dropping.value = false
}
function filesDrop(event: DragEvent) {
  if (!carriesFiles(event)) return
  event.preventDefault()
  depth = 0
  dropping.value = false
  uploader.value?.add(Array.from(event.dataTransfer?.files ?? []))
}
</script>

<template>
  <div
    :data-ready="ready || undefined"
    class="relative md:grid md:grid-cols-[13.5rem_1fr] md:gap-6"
    @dragenter="filesEnter"
    @dragover="filesOver"
    @dragleave="filesLeave"
    @drop="filesDrop"
  >
    <div
      v-if="dropping"
      class="pointer-events-none absolute -inset-2 z-20 rounded-2xl border-2 border-dashed border-(--app-brand) bg-(--app-surface)/90 p-6"
      data-drop-zone
    >
      <!-- in view however long the library is -->
      <div
        class="sticky top-[35vh] mx-auto flex w-fit max-w-full flex-col items-center gap-2 rounded-xl border border-(--app-border) bg-(--app-card) px-6 py-5 text-center shadow-lg"
      >
        <UIcon name="i-lucide-upload" class="size-7 text-(--app-brand)" aria-hidden="true" />
        <p class="text-lg font-semibold">{{ $t('upload.dropHere') }}</p>
        <p class="text-sm text-(--app-text-muted)">{{ uploader?.limitsText }}</p>
      </div>
    </div>
    <!-- folders: on a computer a column, on a phone a menu above the grid -->
    <nav :aria-label="$t('library.folders.label')" class="max-md:hidden">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-xs font-semibold tracking-wide text-(--app-text-muted) uppercase">
          {{ $t('library.folders.label') }}
        </h2>
        <UButton
          v-if="!readOnly"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-folder-plus"
          class="size-9 justify-center"
          :aria-label="$t('library.folders.new')"
          @click="startCreate(null)"
        />
      </div>
      <ul class="space-y-0.5">
        <li>
          <button
            type="button"
            :class="folderClass('all')"
            :aria-current="isCurrent(null) ? 'true' : undefined"
            class="aria-[current=true]:bg-(--app-surface-sunken) aria-[current=true]:font-semibold"
            @click="filter.folder = null"
          >
            <UIcon name="i-lucide-images" class="size-4 shrink-0" aria-hidden="true" />
            {{ $t('library.folders.all') }}
          </button>
        </li>
        <li>
          <button
            type="button"
            :class="folderClass('none')"
            :aria-current="isCurrent('none') ? 'true' : undefined"
            class="aria-[current=true]:bg-(--app-surface-sunken) aria-[current=true]:font-semibold"
            @click="filter.folder = 'none'"
            @dragover="dragOver($event, 'none')"
            @dragleave="dropOn = null"
            @drop="drop($event, 'none')"
          >
            <UIcon name="i-lucide-inbox" class="size-4 shrink-0" aria-hidden="true" />
            {{ $t('library.folders.none') }}
          </button>
        </li>
        <li v-for="f in tree" :key="f.id">
          <button
            type="button"
            :class="folderClass(f.id)"
            :style="{ paddingLeft: `${0.625 + f.depth * 0.875}rem` }"
            :aria-current="isCurrent(f.id) ? 'true' : undefined"
            :data-folder="f.name"
            class="aria-[current=true]:bg-(--app-surface-sunken) aria-[current=true]:font-semibold"
            @click="filter.folder = f.id"
            @dragover="dragOver($event, f.id)"
            @dragleave="dropOn = null"
            @drop="drop($event, f.id)"
          >
            <UIcon
              :name="isCurrent(f.id) ? 'i-lucide-folder-open' : 'i-lucide-folder'"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
            <span class="text-xs text-(--app-text-muted) tabular-nums">
              <span aria-hidden="true">{{ f.fileCount }}</span>
              <span class="sr-only">{{
                $t('library.folders.files', { n: f.fileCount }, f.fileCount)
              }}</span>
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <div class="min-w-0">
      <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div class="flex items-center justify-between gap-3 lg:contents">
          <SegmentedFilter
            v-model="filter.kind"
            :label="$t('library.kind.label')"
            :options="kindOptions"
            class="self-start"
          />
          <UButton
            v-if="!readOnly && !uploadInHeader"
            icon="i-lucide-upload"
            class="min-h-11 shrink-0 lg:order-last"
            @click="chooseFiles"
          >
            {{ $t('upload.choose') }}
          </UButton>
        </div>
        <div class="flex flex-1 flex-wrap gap-3">
          <div class="flex w-full gap-2 md:hidden">
            <USelect
              v-model="folderValue"
              :items="folderItems"
              :aria-label="$t('library.folders.choose')"
              class="min-w-0 flex-1 text-sm"
              size="xl"
              icon="i-lucide-folder"
              :ui="{ leadingIcon: 'size-[1.125rem]' }"
            />
            <UButton
              v-if="!readOnly"
              color="neutral"
              variant="outline"
              icon="i-lucide-folder-plus"
              class="size-11 shrink-0 justify-center"
              :aria-label="$t('library.folders.new')"
              @click="startCreate(current?.id ?? null)"
            />
          </div>
          <SearchField v-model="filter.q" :label="$t('library.search')" class="min-w-48 flex-1" />
          <USelect
            v-if="lib.tags.value.length > 0"
            v-model="tagValue"
            :items="tagItems"
            :aria-label="$t('library.tag.label')"
            icon="i-lucide-tag"
            class="min-w-40 text-sm max-md:flex-1"
            size="xl"
            :ui="{ leadingIcon: 'size-[1.125rem]' }"
          />
        </div>
      </div>

      <div v-if="current" class="mb-3 flex min-h-11 items-center gap-2">
        <UIcon name="i-lucide-folder-open" class="size-5 shrink-0" aria-hidden="true" />
        <h2 class="min-w-0 truncate text-lg font-semibold">{{ current.name }}</h2>
        <RowActions
          v-if="!readOnly"
          :name="current.name"
          :items="folderActions(current)"
          class="ml-auto"
        />
      </div>
      <ul v-if="current && subfoldersOf(current.id).length > 0" class="mb-4 flex flex-wrap gap-2">
        <li v-for="sub in subfoldersOf(current.id)" :key="sub.id">
          <button
            type="button"
            class="flex min-h-11 items-center gap-2 rounded-[10px] border border-(--app-border) bg-(--app-card) px-3 text-sm hover:bg-(--app-surface-sunken)"
            :class="dropOn === sub.id ? 'ring-2 ring-(--app-brand)' : ''"
            @click="filter.folder = sub.id"
            @dragover="dragOver($event, sub.id)"
            @dragleave="dropOn = null"
            @drop="drop($event, sub.id)"
          >
            <UIcon name="i-lucide-folder" class="size-4" aria-hidden="true" />
            {{ sub.name }}
            <span class="text-(--app-text-muted) tabular-nums">
              <span aria-hidden="true">{{ sub.fileCount }}</span>
              <span class="sr-only">{{
                $t('library.folders.files', { n: sub.fileCount }, sub.fileCount)
              }}</span>
            </span>
          </button>
        </li>
      </ul>

      <MediaUploader
        v-if="!readOnly"
        ref="uploader"
        :workspace="workspace"
        :folder-id="uploadFolder"
        @changed="lib.load()"
      />

      <p v-if="done" role="status" class="mb-3 text-sm text-(--app-success)">{{ done }}</p>
      <p v-if="problem" role="alert" class="mb-3 text-sm text-(--app-danger)">{{ problem }}</p>

      <ul
        v-if="status === 'pending' && files.length === 0"
        :aria-label="$t('library.loading')"
        aria-busy="true"
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
      >
        <li
          v-for="n in 8"
          :key="n"
          class="rounded-xl border border-(--app-border) bg-(--app-card) p-2"
        >
          <div class="skeleton aspect-square rounded-lg" />
          <div class="skeleton mt-2 h-4 w-3/4 rounded" />
          <div class="skeleton mt-1.5 h-3 w-1/3 rounded" />
        </li>
      </ul>
      <div
        v-else-if="status === 'error'"
        role="alert"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-card) p-5"
      >
        <p>{{ $t('library.loadError') }}</p>
        <UButton class="min-h-11" color="neutral" variant="outline" @click="lib.load()">
          {{ $t('account.retry') }}
        </UButton>
      </div>
      <template v-else-if="files.length === 0">
        <div
          v-if="filtering"
          class="flex flex-wrap items-center gap-3 rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-5 text-(--app-text-muted)"
        >
          <span class="flex-1">{{ $t('library.noMatch') }}</span>
          <UButton class="min-h-11" color="neutral" variant="outline" @click="clearFilters">
            {{ $t('library.clearFilters') }}
          </UButton>
        </div>
        <EmptyState
          v-else-if="current"
          :title="$t('library.emptyFolder')"
          :text="readOnly ? undefined : $t('library.emptyFolderText')"
          icon="i-lucide-folder-open"
        />
        <EmptyState
          v-else
          :title="$t('library.empty')"
          :text="$t('library.emptyText')"
          icon="i-lucide-images"
        />
      </template>
      <template v-else>
        <div class="mb-3 flex items-center justify-end gap-3" data-view-controls>
          <div
            v-if="view.layout === 'grid'"
            class="flex min-h-11 items-center gap-2 text-(--app-text-muted)"
            data-thumb-size
          >
            <UIcon name="i-lucide-image" class="size-3.5 shrink-0" aria-hidden="true" />
            <USlider
              v-model="view.size"
              :min="0"
              :max="THUMB_SIZES.length - 1"
              :step="1"
              class="w-24"
              :ui="{ root: 'max-md:h-11', track: 'bg-(--app-border-strong)' }"
              :aria-label="$t('library.view.size')"
              :aria-valuetext="sizeText"
            />
            <UIcon name="i-lucide-image" class="size-5 shrink-0" aria-hidden="true" />
          </div>
          <div
            role="group"
            :aria-label="$t('library.view.label')"
            class="inline-flex shrink-0 rounded-[0.625rem] border border-(--app-border) bg-(--app-groove) p-[3px]"
          >
            <button
              v-for="o in layoutOptions"
              :key="o.value"
              type="button"
              :aria-pressed="view.layout === o.value"
              :aria-label="o.label"
              :title="o.label"
              class="flex size-11 items-center justify-center rounded-[0.4375rem] transition-colors md:size-9"
              :class="
                view.layout === o.value
                  ? 'bg-(--app-card) text-(--app-text) shadow-[0_1px_2px_rgb(36_35_33/0.15)]'
                  : 'text-(--app-text-muted) hover:text-(--app-text)'
              "
              @click="view.layout = o.value"
            >
              <UIcon :name="o.icon" class="size-[1.125rem]" aria-hidden="true" />
            </button>
          </div>
        </div>
        <ul
          :aria-label="$t('library.title')"
          :class="view.layout === 'grid' ? 'grid gap-3' : 'space-y-2'"
          :style="gridStyle"
          :data-layout="view.layout"
        >
          <MediaTile
            v-for="f in files"
            :key="f.id"
            :file="f"
            :src="thumb(f)"
            :actions="fileActions(f)"
            :layout="view.layout"
            @open="selected = f"
          />
        </ul>
        <div v-if="lib.next.value" class="mt-5 flex justify-center">
          <UButton
            class="min-h-11"
            color="neutral"
            variant="outline"
            :loading="lib.loadingMore.value"
            @click="showMore"
          >
            {{ $t('library.more') }}
          </UButton>
        </div>
      </template>
    </div>

    <MediaDetail
      v-model:open="detailOpen"
      :file="selected"
      :folders="tree"
      :file-url="lib.fileUrl"
      :read-only="readOnly"
      @tags="saveTags"
      @move="move"
      @delete="(f) => (deleting = f)"
    />

    <UModal
      v-model:open="moveOpen"
      :title="$t('library.moveTitle', { name: moving?.originalName ?? '' })"
    >
      <template #body>
        <form id="move-file" novalidate @submit.prevent="confirmMove">
          <UFormField :label="$t('library.folders.choose')" name="move-target">
            <USelect v-model="moveTarget" :items="moveItems" class="w-full" size="xl" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" form="move-file" class="min-h-11">
            {{ $t('library.move') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="moving = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      :title="$t('library.deleteTitle', { name: deleting?.originalName ?? '' })"
      :description="$t('library.deleteText')"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton class="min-h-11" color="error" @click="confirmDelete">
            {{ $t('library.delete') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="deleting = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="nameOpen" :title="nameTitle">
      <template #body>
        <form id="folder-name" novalidate @submit.prevent="saveName">
          <UFormField
            :label="$t('library.folders.name')"
            name="folder-name"
            :error="nameProblem ?? undefined"
          >
            <UInput v-model="folderName" class="w-full" size="xl" maxlength="80" autofocus />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" form="folder-name" class="min-h-11">
            {{ naming?.mode === 'rename' ? $t('account.save') : $t('library.folders.create') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="naming = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="removeFolderOpen"
      :title="$t('library.folders.deleteTitle', { name: removingFolder?.name ?? '' })"
      :description="removingDescription"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton class="min-h-11" color="error" @click="confirmRemoveFolder">
            {{ removingFull ? $t('library.folders.deleteAll') : $t('library.folders.delete') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="removingFolder = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
