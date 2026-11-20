<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { LibraryFile } from '~/composables/useLibrary'
import { useAgencyLibrary, type LibraryUse } from '~/composables/useAgencyLibrary'

/**
 * «Libreria» of the agency (screen 19, Matteo 20/11): the files of every client whose library the
 * person uses, grouped by day, with the filters by type, client and use beside the search, and
 * «Carica». A file opens its detail on the right (screen 20). The folders stay in the client's
 * own library («Libreria» tab of the client).
 */
const props = defineProps<{
  /** the clients whose library the person uses, not archived */
  clients: WorkspaceView[]
  /** the client of the context selector, if any: the filter starts on it */
  initialClient: string | null
}>()
const { t } = useI18n()
const { failure } = useApi()
const org = useOrganization()
const lib = useAgencyLibrary({ workspaceId: props.initialClient })
const { filter, files, counts, status } = lib
const { view } = useLibraryView()

const clientOf = (id: string) => props.clients.find((c) => c.id === id) ?? null
watch(
  () => props.initialClient,
  (id) => (filter.workspaceId = id),
)

const kindOptions = computed(() => [
  {
    value: 'all' as const,
    label: t('library.all'),
    count: counts.value.image + counts.value.video,
  },
  { value: 'image' as const, label: t('library.photos'), count: counts.value.image },
  { value: 'video' as const, label: t('library.videos'), count: counts.value.video },
])
const clientItems = computed(() => [
  { value: 'all', label: t('library.allClients') },
  ...props.clients.map((c) => ({ value: c.id, label: c.name })),
])
const clientValue = computed({
  get: () => filter.workspaceId ?? 'all',
  set: (v: string) => (filter.workspaceId = v === 'all' ? null : v),
})
const USES: LibraryUse[] = ['all', 'any', 'scheduled', 'draft', 'unused']
const useItems = computed(() => USES.map((u) => ({ value: u, label: t(`library.useFilter.${u}`) })))
const layoutOptions = computed(() => [
  { value: 'grid' as const, icon: 'i-lucide-layout-grid', label: t('library.view.grid') },
  { value: 'list' as const, icon: 'i-lucide-layout-list', label: t('library.view.list') },
])

// the groups of the day the page was opened on («Oggi», «Ieri»…)
const now = new Date()
const groups = computed(() => groupByDay(files.value, now))
const meta = (f: LibraryFile) =>
  [clientOf(f.workspaceId)?.name, formatBytes(f.sizeBytes)].filter(Boolean).join(' · ')
const thumb = (f: LibraryFile) => {
  const variant = thumbnailOf(f)
  return variant ? lib.fileUrl(f, variant) : null
}

const done = useFlash()
const problem = ref<string | null>(null)
function say(message: string) {
  problem.value = null
  done.value = message
}

// ---- the detail
const selected = ref<LibraryFile | null>(null)
const detailOpen = computed({
  get: () => selected.value !== null,
  set: (v) => {
    if (!v) selected.value = null
  },
})
const clientPath = (f: LibraryFile) =>
  `/spazi/${encodeURIComponent(clientOf(f.workspaceId)?.slug ?? '')}`
const postTo = (f: LibraryFile, postId: string) =>
  org.to(`${clientPath(f)}/post/${encodeURIComponent(postId)}`)
const newPostTo = (f: LibraryFile) =>
  org.to(`${clientPath(f)}/post/nuovo?file=${encodeURIComponent(f.id)}`)

async function saveTags(file: LibraryFile, tags: string[]) {
  try {
    const updated = await lib.saveTags(file, tags)
    if (selected.value?.id === file.id) selected.value = updated
    say(t('library.detail.tagsSaved'))
  } catch (e) {
    problem.value = failure(e).message
  }
}
async function retry(file: LibraryFile) {
  try {
    const again = await lib.retry(file)
    if (selected.value?.id === file.id) selected.value = again
    say(t('library.retried', { name: file.originalName }))
  } catch (e) {
    problem.value = failure(e).message
  }
}

// ---- delete: never for a file the server says is not deleted (D-80.4)
const deleting = ref<LibraryFile | null>(null)
const deleteOpen = computed({
  get: () => deleting.value !== null,
  set: (v) => {
    if (!v) deleting.value = null
  },
})
function startDelete(file: LibraryFile) {
  if (!file.deleteBlockedBy) deleting.value = file
}
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
    // scheduled meanwhile: the file read again says why, as if it had said so before
    const fresh = await lib.refresh(file).catch(() => null)
    if (fresh && selected.value?.id === file.id) selected.value = fresh
    problem.value = fresh?.deleteBlockedBy ? deleteBlockText(fresh.deleteBlockedBy, t) : f.message
  }
}
function fileActions(file: LibraryFile): DropdownMenuItem[][] {
  const block = file.deleteBlockedBy
  return [
    [
      {
        label: t('library.open'),
        icon: 'i-lucide-panel-right-open',
        onSelect: () => (selected.value = file),
      },
    ],
    [
      {
        label: t('library.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        ...(block ? { disabled: true, description: deleteBlockText(block, t) } : {}),
        onSelect: () => startDelete(file),
      },
    ],
  ]
}

// ---- «Carica»: into the client of the filter, else the person chooses one
const uploadClient = ref<WorkspaceView | null>(null)
const uploader = ref<{ choose: () => void } | null>(null)
async function uploadInto(client: WorkspaceView) {
  uploadClient.value = client
  await nextTick()
  uploader.value?.choose()
}
const uploadItems = computed<DropdownMenuItem[]>(() =>
  props.clients.map((c) => ({ label: c.name, onSelect: () => void uploadInto(c) })),
)
const filteredClient = computed(() =>
  filter.workspaceId
    ? clientOf(filter.workspaceId)
    : props.clients.length === 1
      ? props.clients[0]
      : null,
)
function upload() {
  if (filteredClient.value) void uploadInto(filteredClient.value)
}
defineExpose({ upload, uploadItems, filteredClient })

async function showMore() {
  if (!(await lib.more())) problem.value = t('library.loadError')
}
const filtering = computed(
  () =>
    filter.kind !== 'all' ||
    filter.use !== 'all' ||
    filter.q.trim() !== '' ||
    filter.workspaceId !== null,
)
function clearFilters() {
  Object.assign(filter, { kind: 'all', use: 'all', q: '', workspaceId: null })
}
</script>

<template>
  <div :data-ready="status === 'success' ? '' : undefined">
    <div class="mb-5 flex flex-wrap items-center gap-3 max-md:gap-2" data-library-tools>
      <SegmentedFilter
        v-model="filter.kind"
        :label="$t('library.kind.label')"
        :options="kindOptions"
        class="max-md:flex max-md:w-full max-md:[&>*]:flex-1"
      />
      <USelect
        v-model="clientValue"
        :items="clientItems"
        :aria-label="$t('library.clientFilter')"
        color="neutral"
        variant="outline"
        class="min-w-34 font-medium max-md:hidden"
        data-client-filter
      />
      <USelect
        v-model="filter.use"
        :items="useItems"
        :aria-label="$t('library.useFilter.label')"
        color="neutral"
        variant="outline"
        class="min-w-36 font-medium max-md:hidden"
        data-use-filter
      />
      <SearchField v-model="filter.q" :label="$t('library.searchAll')" />
      <span class="flex-1 max-md:hidden" />
      <div
        role="group"
        :aria-label="$t('library.view.label')"
        class="inline-flex gap-0.5 rounded-control border border-(--app-border) bg-(--app-surface-sunken) p-[3px] max-md:hidden"
      >
        <button
          v-for="o in layoutOptions"
          :key="o.value"
          type="button"
          class="flex h-7 w-8 items-center justify-center rounded-[6px] text-(--app-text-muted)"
          :class="
            view.layout === o.value
              ? 'bg-(--app-card) text-(--app-text) shadow-[0_0_0_1px_var(--app-border)]'
              : ''
          "
          :aria-label="o.label"
          :aria-pressed="view.layout === o.value"
          @click="view.layout = o.value"
        >
          <UIcon :name="o.icon" class="size-4" />
        </button>
      </div>
      <div class="max-md:hidden">
        <UButton
          v-if="filteredClient"
          color="neutral"
          variant="outline"
          icon="i-lucide-upload"
          :label="$t('library.upload')"
          @click="upload"
        />
        <UDropdownMenu
          v-else-if="clients.length > 0"
          :items="uploadItems"
          :content="{ align: 'end' }"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-upload"
            :label="$t('library.upload')"
            :aria-label="$t('library.uploadTo')"
          />
        </UDropdownMenu>
      </div>
    </div>

    <MediaUploader
      v-if="uploadClient"
      ref="uploader"
      :key="uploadClient.id"
      :workspace="uploadClient"
      :folder-id="null"
      @changed="lib.load()"
    />

    <p v-if="problem" role="alert" class="mb-3 text-sm text-(--app-danger)">{{ problem }}</p>

    <ListSkeleton
      v-if="status === 'pending' && files.length === 0"
      :label="$t('library.loading')"
      :rows="3"
    />
    <EmptyState
      v-else-if="status === 'error'"
      :title="$t('library.loadError')"
      icon="i-lucide-images"
    >
      <UButton
        color="neutral"
        variant="outline"
        :label="$t('library.detail.retry')"
        @click="lib.load()"
      />
    </EmptyState>
    <EmptyState
      v-else-if="files.length === 0"
      :title="filtering ? $t('library.noMatch') : $t('library.empty')"
      icon="i-lucide-images"
    >
      <UButton
        v-if="filtering"
        color="neutral"
        variant="outline"
        :label="$t('library.clearFilters')"
        @click="clearFilters"
      />
    </EmptyState>
    <template v-else>
      <section
        v-for="g in groups"
        :key="g.key"
        :aria-labelledby="`library-day-${g.key}`"
        class="mb-5"
      >
        <h2
          :id="`library-day-${g.key}`"
          class="mb-2.5 text-xs font-medium text-(--app-text-muted)"
          data-library-day
        >
          {{ g.label }}
        </h2>
        <ul
          :aria-labelledby="`library-day-${g.key}`"
          :class="
            view.layout === 'grid'
              ? 'grid grid-cols-3 gap-x-2 gap-y-4 md:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] md:gap-x-4 md:gap-y-5'
              : 'grid gap-2'
          "
          data-library-grid
        >
          <MediaTile
            v-for="f in g.files"
            :key="f.id"
            :file="f"
            :src="thumb(f)"
            :meta="meta(f)"
            :layout="view.layout"
            :actions="fileActions(f)"
            @open="selected = f"
          />
        </ul>
      </section>
      <div v-if="lib.next.value" class="mt-2 flex justify-center">
        <UButton
          color="neutral"
          variant="outline"
          :loading="lib.loadingMore.value"
          :label="$t('library.more')"
          @click="showMore"
        />
      </div>
    </template>

    <MediaDetail
      v-model:open="detailOpen"
      :file="selected"
      :file-url="lib.fileUrl"
      :read-only="false"
      :post-to="postTo"
      :new-post-to="newPostTo"
      :client-name="selected ? (clientOf(selected.workspaceId)?.name ?? null) : null"
      @tags="saveTags"
      @delete="startDelete"
      @retry="retry"
    />

    <UModal
      v-model:open="deleteOpen"
      :title="$t('library.deleteTitle', { name: deleting?.originalName ?? '' })"
      :description="$t('library.deleteText')"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="deleting = null">
            {{ $t('security.cancel') }}
          </UButton>
          <UButton class="min-h-control" color="error" @click="confirmDelete">
            {{ $t('library.delete') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
