<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Folder, LibraryFile } from '~/composables/useLibrary'
import { THUMB_SIZES } from '~/composables/useLibraryView'

/**
 * The library of one client (spec §11.8, plan 04 Task 12; brief F03): folders on the left (a
 * menu on a phone), filters by type, tag and name, a grid of files by pages, the detail on the
 * side. A file moves into a folder by dragging it there or with «Sposta in…»; every folder of the
 * column has its «⋯» (new folder inside, rename, move, delete: D-103). Used by
 * `/<agenzia>/libreria` and by the client's «Libreria» tab. An archived client is read only.
 */
const props = defineProps<{
  workspace: WorkspaceView
  /** the page puts «Carica file» in its head (`chooseFiles`) */
  uploadInHeader?: boolean
  /**
   * On the page «Libreria» (D-103): the clients of its filter, to go to another one or back to
   * «Tutti i clienti». The client's own tab has no such filter.
   */
  clients?: WorkspaceView[]
}>()
const { t } = useI18n()
const { failure } = useApi()
const ready = useHydrated()
const org = useOrganization()
/** The editor of a post of this client: «Usato in» and the reason a file is not deleted. */
const clientPath = () => `/spazi/${encodeURIComponent(props.workspace.slug)}`
const postTo = (_file: LibraryFile, postId: string) =>
  org.to(`${clientPath()}/post/${encodeURIComponent(postId)}`)
/** «Usa in un nuovo post» (screen 20) */
const newPostTo = (file: LibraryFile) =>
  org.to(`${clientPath()}/post/nuovo?file=${encodeURIComponent(file.id)}`)

// ---- the folder open is in the address (`?cartella=<id>`, `none` for «Senza cartella», D-103)
const route = useRoute()
const router = useRouter()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const askedFolder = (): string | null => {
  const asked = route.query['cartella']
  return typeof asked === 'string' && (asked === 'none' || UUID.test(asked)) ? asked : null
}
/** The address with these changes; a null value takes the key away. */
function withQuery(change: Record<string, string | null>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query))
    if (typeof value === 'string') query[key] = value
  for (const [key, value] of Object.entries(change))
    if (value === null) delete query[key]
    else query[key] = value
  return query
}

const workspaceId = computed(() => props.workspace.id)
const lib = useLibrary(workspaceId, { folder: askedFolder() })
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
watch(
  () => route.query['cartella'],
  () => {
    const asked = askedFolder()
    if (asked !== filter.folder) filter.folder = asked
  },
)
watch(
  () => filter.folder,
  (folder) => {
    if (folder !== askedFolder()) void router.replace({ query: withQuery({ cartella: folder }) })
  },
)
// a folder of the address that is not there (deleted, of another client): all the files
watch(folders, (list) => {
  const open = filter.folder
  if (open && open !== 'none' && status.value === 'success' && !list.some((f) => f.id === open))
    filter.folder = null
})

// ---- the client of the page «Libreria», by the filter or back to «Tutti i clienti»
const clientItems = computed(() => [
  { value: 'all', label: t('library.allClients') },
  ...(props.clients ?? []).map((c) => ({ value: c.id, label: c.name })),
])
const clientValue = computed({
  get: () => props.workspace.id,
  set: (id: string) => {
    const client = props.clients?.find((c) => c.id === id)
    void router.replace({
      query: withQuery({ spazio: client?.slug ?? null, cartella: null, profilo: null }),
    })
  },
})
const allClients = computed(() => ({
  query: withQuery({ spazio: null, cartella: null, profilo: null }),
}))

const filtering = computed(
  () => filter.kind !== 'all' || filter.tag !== null || filter.q.trim() !== '' || filter.inPosts,
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
  ...tree.value.map((f) => ({ value: f.id, label: f.path })),
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
  Object.assign(filter, { kind: 'all', tag: null, q: '', inPosts: false })
}

// ---- the detail
const selected = ref<LibraryFile | null>(null)
// a file the worker prepares again («Riprova»): the detail follows the list
watch(
  () => lib.files.value,
  (files) => {
    const shown = selected.value
    const fresh = shown && files.find((f) => f.id === shown.id)
    if (fresh && fresh !== shown && fresh.status !== shown.status) selected.value = fresh
  },
)
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
async function retry(file: LibraryFile) {
  const ok = await attempt(async () => {
    const again = await lib.retry(file)
    if (selected.value?.id === file.id) selected.value = again
  })
  if (ok) say(t('library.retried', { name: file.originalName }))
}
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
  done.value = null
  problem.value = null
  try {
    await lib.remove(file)
    if (selected.value?.id === file.id) selected.value = null
    say(t('library.deleted', { name: file.originalName }))
  } catch (e) {
    const f = failure(e)
    if (f.reason !== 'media_in_scheduled_post') {
      problem.value = f.message
      return
    }
    // scheduled meanwhile (D-80.4): the file read again says why, as if it had said so before
    const fresh = await lib.refresh(file).catch(() => null)
    if (fresh && selected.value?.id === file.id) selected.value = fresh
    problem.value = fresh?.deleteBlockedBy ? deleteBlockText(fresh.deleteBlockedBy, t) : f.message
  }
}
/** Starts deleting a file: never for a file the server says is not deleted (D-80.4). */
function startDelete(file: LibraryFile) {
  if (!file.deleteBlockedBy) deleting.value = file
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
    const block = file.deleteBlockedBy
    groups.push([
      {
        label: t('library.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        // off, with the reason, before anyone tries (D-80.4)
        ...(block ? { disabled: true, description: deleteBlockText(block, t) } : {}),
        onSelect: () => startDelete(file),
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
// ---- move a folder, with what it holds (D-103)
const movingFolder = ref<Folder | null>(null)
const folderTarget = ref('top')
const moveFolderOpen = computed({
  get: () => movingFolder.value !== null,
  set: (v) => {
    if (!v) movingFolder.value = null
  },
})
/** Where the folder being moved can go, as the menu lists them: the top, then the tree. */
const folderTargets = computed(() => {
  const folder = movingFolder.value
  if (!folder) return []
  const allowed = new Set(folderMoveTargets(tree.value, folder.id))
  return [
    ...(allowed.has(null) ? [{ value: 'top', label: t('library.folders.moveTop') }] : []),
    ...tree.value
      .filter((f) => allowed.has(f.id))
      .map((f) => ({ value: f.id, label: f.path })),
  ]
})
function startMoveFolder(folder: Folder) {
  movingFolder.value = folder
  folderTarget.value = folderTargets.value[0]?.value ?? 'top'
}
async function confirmMoveFolder() {
  const folder = movingFolder.value
  if (!folder || folderTargets.value.length === 0) return
  movingFolder.value = null
  const parentId = folderTarget.value === 'top' ? null : folderTarget.value
  const ok = await attempt(() => lib.moveFolder(folder, parentId))
  if (ok)
    say(
      parentId === null
        ? t('library.folders.movedTop', { name: folder.name })
        : t('library.folders.moved', { name: folder.name, folder: folderLabel(parentId) }),
    )
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
  done.value = null
  problem.value = null
  try {
    await lib.deleteFolder(folder)
    say(t('library.folders.deleted'))
  } catch (e) {
    const f = failure(e)
    problem.value = f.message
    // a file scheduled meanwhile: the folders read again say it before the next try
    if (f.reason === 'media_in_scheduled_post') await lib.reloadFolders().catch(() => undefined)
  }
}
/** Files in the folder and below it that a scheduled post keeps (D-80.4). */
const blockedIn = (folder: Folder) =>
  [folder, ...foldersBelow(folders.value, folder.id)].reduce((n, f) => n + f.blockedFiles, 0)
function folderActions(folder: Folder): DropdownMenuItem[][] {
  const blocked = blockedIn(folder)
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
      {
        label: t('library.folders.move'),
        icon: 'i-lucide-folder-input',
        onSelect: () => startMoveFolder(folder),
      },
    ],
    [
      {
        label: t('library.folders.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        ...(blocked > 0 ? { disabled: true, description: folderBlockText(blocked, t) } : {}),
        onSelect: () => {
          if (blockedIn(folder) === 0) removingFolder.value = folder
        },
      },
    ],
  ]
}
const folderClass = (target: string) => [
  'flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left font-medium text-(--app-text-muted) transition-colors aria-[current=true]:text-(--app-text)',
  dropOn.value === target
    ? 'bg-(--app-brand-soft) ring-2 ring-(--app-brand) ring-inset'
    : 'hover:bg-(--app-nav-hover) hover:text-(--app-text)',
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
  if (!carriesFiles(event) || !event.dataTransfer) return
  event.preventDefault()
  depth = 0
  dropping.value = false
  const files = Array.from(event.dataTransfer.files)
  // a folder, or a zip alone: first the window that says what will happen (D-104)
  const folder = folderDrop(event.dataTransfer)
  if (folder)
    folder.then(
      (list) => treeUpload.value?.start({ files: list }),
      () => (problem.value = t('treeUpload.dropFailed')),
    )
  else if (files.length === 1 && files[0] && isZip(files[0]))
    void treeUpload.value?.start({ zip: files[0] })
  else uploader.value?.add(files)
}

// ---- a folder or a zip (D-104): «Carica» opens a menu with them
const treeUpload = ref<{
  start: (input: { files: TreeFile[] } | { zip: File }) => Promise<void>
} | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const zipInput = ref<HTMLInputElement | null>(null)
function folderPicked(event: Event) {
  const el = event.target as HTMLInputElement
  const list = Array.from(el.files ?? [])
  el.value = ''
  if (list.length > 0) void treeUpload.value?.start({ files: filesFromDirectoryInput(list) })
}
function zipPicked(event: Event) {
  const el = event.target as HTMLInputElement
  const zip = el.files?.[0]
  el.value = ''
  if (zip) void treeUpload.value?.start({ zip })
}
const uploadItems = computed<DropdownMenuItem[]>(() => [
  { label: t('upload.choose'), icon: 'i-lucide-image-up', onSelect: chooseFiles },
  {
    label: t('upload.chooseFolder'),
    icon: 'i-lucide-folder-up',
    onSelect: () => folderInput.value?.click(),
  },
  {
    label: t('upload.chooseZip'),
    icon: 'i-lucide-file-archive',
    onSelect: () => zipInput.value?.click(),
  },
])
function treeDone(message: string) {
  say(message)
  void lib.load()
}
defineExpose({
  chooseFiles,
  chooseFolder: () => folderInput.value?.click(),
  chooseZip: () => zipInput.value?.click(),
})
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
        class="sticky top-[35vh] mx-auto flex w-fit max-w-full flex-col items-center gap-2 rounded-xl border border-(--app-border) bg-(--app-surface) px-6 py-5 text-center shadow-lg"
      >
        <UIcon name="i-lucide-upload" class="size-7 text-(--app-brand)" aria-hidden="true" />
        <p class="text-lg font-semibold">{{ $t('upload.dropHere') }}</p>
        <p class="text-sm text-(--app-text-muted)">{{ uploader?.limitsText }}</p>
      </div>
    </div>
    <!-- folders: on a computer a column, on a phone a menu above the grid -->
    <nav :aria-label="$t('library.folders.label')" class="max-md:hidden">
      <NuxtLink
        v-if="clients"
        :to="allClients"
        class="mb-3 flex h-9 items-center gap-2 rounded-control px-2.5 text-sm font-medium text-(--app-text-muted) hover:bg-(--app-nav-hover) hover:text-(--app-text)"
        data-all-clients
      >
        <UIcon name="i-lucide-arrow-left" class="size-4 shrink-0" aria-hidden="true" />
        {{ $t('library.tree.back') }}
      </NuxtLink>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="px-2.5 text-caption font-medium text-(--app-text-muted)">
          {{ $t('library.folders.label') }}
        </h2>
        <UButton
          v-if="!readOnly"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-folder-plus"
          class="min-h-8 font-medium pointer-coarse:min-h-11"
          data-new-folder
          @click="startCreate(null)"
        >
          {{ $t('library.folders.new') }}
        </UButton>
      </div>
      <ul class="space-y-0.5">
        <li>
          <button
            type="button"
            :class="folderClass('all')"
            :aria-current="isCurrent(null) ? 'true' : undefined"
            class="aria-[current=true]:bg-(--app-nav-hover) aria-[current=true]:font-semibold"
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
            class="aria-[current=true]:bg-(--app-nav-hover) aria-[current=true]:font-semibold"
            @click="filter.folder = 'none'"
            @dragover="dragOver($event, 'none')"
            @dragleave="dropOn = null"
            @drop="drop($event, 'none')"
          >
            <UIcon name="i-lucide-inbox" class="size-4 shrink-0" aria-hidden="true" />
            {{ $t('library.folders.none') }}
          </button>
        </li>
        <li v-for="f in tree" :key="f.id" class="group/folder relative">
          <button
            type="button"
            :class="[folderClass(f.id), readOnly ? '' : 'pointer-coarse:h-11 pointer-coarse:pr-12']"
            :style="{ paddingLeft: `${0.625 + f.depth * 0.875}rem` }"
            :aria-current="isCurrent(f.id) ? 'true' : undefined"
            :data-folder="f.name"
            class="aria-[current=true]:bg-(--app-nav-hover) aria-[current=true]:font-semibold"
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
            <!-- the «⋯» takes the count's place on hover (on touch it has its own) -->
            <span class="text-xs text-(--app-text-muted) tabular-nums">
              <span
                aria-hidden="true"
                :class="
                  readOnly
                    ? ''
                    : 'group-focus-within/folder:invisible group-hover/folder:invisible group-has-[[data-state=open]]/folder:invisible pointer-coarse:visible!'
                "
                >{{ f.fileCount }}</span
              >
              <span class="sr-only">{{
                $t('library.folders.files', { n: f.fileCount }, f.fileCount)
              }}</span>
            </span>
          </button>
          <!-- «⋯» of every folder (D-103): in view on hover, with the keyboard and on touch -->
          <span
            v-if="!readOnly"
            class="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 transition-opacity group-focus-within/folder:opacity-100 group-hover/folder:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100"
            data-folder-actions
          >
            <RowActions
              compact
              :name="f.name"
              :label="$t('library.folders.actionsFor', { name: f.name })"
              :items="folderActions(f)"
            />
          </span>
        </li>
      </ul>
      <!-- the client's space, quiet under its folders (on a phone the page says it) -->
      <p class="mt-4 px-2.5 text-caption text-(--app-text-muted)" data-library-usage>
        {{ $t('library.usageOf', { used: formatBytes(lib.usedBytes.value) }) }}
      </p>
    </nav>

    <div class="min-w-0">
      <!-- the tools of the agency's library (screen 19), in the same order and look -->
      <div class="mb-5 flex flex-wrap items-center gap-3 max-md:gap-2" data-library-tools>
        <SegmentedFilter
          v-model="filter.kind"
          :label="$t('library.kind.label')"
          :options="kindOptions"
          class="max-md:flex max-md:w-full max-md:[&>*]:flex-1"
        />
        <USelect
          v-if="clients"
          v-model="clientValue"
          :items="clientItems"
          :aria-label="$t('library.clientFilter')"
          color="neutral"
          variant="outline"
          class="w-full font-medium md:hidden"
          data-client-filter
        />
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
            class="min-h-11 shrink-0 font-medium"
            data-new-folder
            @click="startCreate(current?.id ?? null)"
          >
            {{ $t('library.folders.new') }}
          </UButton>
        </div>
        <SearchField v-model="filter.q" :label="$t('library.search')" class="md:max-w-52!" />
        <USelect
          v-if="lib.tags.value.length > 0"
          v-model="tagValue"
          :items="tagItems"
          :aria-label="$t('library.tag.label')"
          icon="i-lucide-tag"
          color="neutral"
          variant="outline"
          class="min-w-36 font-medium max-md:flex-1"
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-calendar-check"
          class="shrink-0 font-medium aria-pressed:bg-(--app-nav-hover) aria-pressed:font-semibold"
          :aria-pressed="filter.inPosts"
          data-in-posts
          @click="filter.inPosts = !filter.inPosts"
        >
          {{ $t('library.inPosts.filter') }}
        </UButton>
        <span class="flex-1 max-md:hidden" />
        <div
          class="ms-auto flex items-center gap-3 max-md:w-full max-md:justify-between"
          data-view-controls
        >
          <div
            v-if="view.layout === 'grid'"
            class="flex min-h-11 items-center gap-2 text-(--app-text-muted) md:min-h-0"
            data-thumb-size
          >
            <UIcon name="i-lucide-image" class="size-3.5 shrink-0" aria-hidden="true" />
            <USlider
              v-model="view.size"
              :min="0"
              :max="THUMB_SIZES.length - 1"
              :step="1"
              color="neutral"
              class="w-16"
              :ui="{ root: 'max-md:h-11', track: 'bg-(--app-border-strong)' }"
              :aria-label="$t('library.view.size')"
              :aria-valuetext="sizeText"
            />
            <UIcon name="i-lucide-image" class="size-5 shrink-0" aria-hidden="true" />
          </div>
          <div
            role="group"
            :aria-label="$t('library.view.label')"
            class="ms-auto inline-flex gap-0.5 rounded-control border border-(--app-border) bg-(--app-surface-sunken) p-[3px]"
          >
            <button
              v-for="o in layoutOptions"
              :key="o.value"
              type="button"
              :aria-pressed="view.layout === o.value"
              :aria-label="o.label"
              :title="o.label"
              class="flex size-11 items-center justify-center rounded-[6px] text-(--app-text-muted) md:h-7 md:w-8"
              :class="
                view.layout === o.value
                  ? 'bg-(--app-surface) text-(--app-text) shadow-[0_0_0_1px_var(--app-border)]'
                  : 'hover:text-(--app-text)'
              "
              @click="view.layout = o.value"
            >
              <UIcon :name="o.icon" class="size-4" aria-hidden="true" />
            </button>
          </div>
          <UDropdownMenu v-if="!readOnly && !uploadInHeader" :items="uploadItems">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              trailing-icon="i-lucide-chevron-down"
              class="shrink-0"
              data-upload-menu
            >
              <!-- on a phone the icon alone: the row has the size and the view too -->
              <span class="max-md:sr-only">{{ $t('upload.menu') }}</span>
            </UButton>
          </UDropdownMenu>
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
            class="flex min-h-11 items-center gap-2 rounded-[10px] border border-(--app-border) bg-(--app-surface) px-3 text-sm hover:bg-(--app-surface-sunken)"
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
        :key="workspace.id"
        ref="uploader"
        :workspace="workspace"
        :folder-id="uploadFolder"
        @changed="lib.load()"
      />
      <template v-if="!readOnly">
        <TreeUpload
          :key="workspace.id"
          ref="treeUpload"
          :workspace="workspace"
          :folders="folders"
          :target-id="uploadFolder"
          @done="treeDone"
          @changed="lib.load()"
        />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          multiple
          class="hidden"
          data-folder-input
          @change="folderPicked"
        />
        <input
          ref="zipInput"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          class="hidden"
          data-zip-input
          @change="zipPicked"
        />
      </template>

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
          class="rounded-xl border border-(--app-border) bg-(--app-surface) p-2"
        >
          <div class="skeleton aspect-square rounded-lg" />
          <div class="skeleton mt-2 h-4 w-3/4 rounded" />
          <div class="skeleton mt-1.5 h-3 w-1/3 rounded" />
        </li>
      </ul>
      <LoadFailed
        v-else-if="status === 'error'"
        :text="$t('library.loadError')"
        @retry="lib.load()"
      />
      <template v-else-if="files.length === 0">
        <div
          v-if="filtering"
          class="flex min-h-row flex-wrap items-center gap-3 rounded-card border border-(--app-border) bg-(--app-surface) px-4 py-3 text-(--app-text-muted)"
        >
          <span class="flex-1">{{ $t('library.noMatch') }}</span>
          <UButton class="min-h-control" color="neutral" variant="outline" @click="clearFilters">
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
            class="min-h-control"
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
      :post-to="postTo"
      :new-post-to="newPostTo"
      @tags="saveTags"
      @move="move"
      @delete="startDelete"
      @retry="retry"
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
          <UButton type="submit" form="move-file" class="min-h-control">
            {{ $t('library.move') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="moving = null">
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
          <UButton class="min-h-control" color="error" @click="confirmDelete">
            {{ $t('library.delete') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="deleting = null">
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
          <UButton type="submit" form="folder-name" class="min-h-control">
            {{ naming?.mode === 'rename' ? $t('account.save') : $t('library.folders.create') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="naming = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="moveFolderOpen"
      :title="$t('library.folders.moveTitle', { name: movingFolder?.name ?? '' })"
    >
      <template #body>
        <p v-if="folderTargets.length === 0" class="text-sm text-(--app-text-muted)">
          {{ $t('library.folders.moveNowhere') }}
        </p>
        <form v-else id="move-folder" novalidate @submit.prevent="confirmMoveFolder">
          <UFormField :label="$t('library.folders.moveTarget')" name="move-folder-target">
            <USelect v-model="folderTarget" :items="folderTargets" class="w-full" size="xl" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton
            v-if="folderTargets.length > 0"
            type="submit"
            form="move-folder"
            class="min-h-control"
          >
            {{ $t('library.move') }}
          </UButton>
          <UButton
            class="min-h-control"
            color="neutral"
            variant="ghost"
            @click="movingFolder = null"
          >
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
          <UButton class="min-h-control" color="error" @click="confirmRemoveFolder">
            {{ removingFull ? $t('library.folders.deleteAll') : $t('library.folders.delete') }}
          </UButton>
          <UButton
            class="min-h-control"
            color="neutral"
            variant="ghost"
            @click="removingFolder = null"
          >
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
