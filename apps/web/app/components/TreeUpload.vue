<script setup lang="ts">
import type { Folder } from '~/composables/useLibrary'

/**
 * A folder or a zip into the library (D-104, D-110). First what will happen, «Creo 2 cartelle e
 * carico 14 file (1,2 GB) in …», with the folder where they go and, when a folder with the same
 * name is there already, «novembre (2)» or «Unisci»; what is left out is said. Then the folders
 * are made, parents first, and the files go into the client's uploads one at a time: a zip is
 * opened one entry at a time, only when the uploads have room, so it is never whole in memory.
 */
const props = defineProps<{
  workspace: WorkspaceView
  folders: Folder[]
  targetId: string | null
}>()
const emit = defineEmits<{ done: [message: string]; changed: [] }>()
const { t } = useI18n()
const { call, failure } = useApi()
const org = useOrganization()
const uploads = useUploads(props.workspace.id)

type Source =
  { kind: 'folder'; files: TreeFile[] } | { kind: 'zip'; zip: File; entries: ZipEntry[] }
interface Item extends TreeItem {
  file?: File
  entry?: ZipEntry
}

const open = ref(false)
const source = ref<Source | null>(null)
const reading = ref(false)
const readProblem = ref<string | null>(null)
const target = ref('top')
const merge = ref<'new' | 'merge'>('new')
const running = ref(false)
const sent = ref(0)
const runProblem = ref<string | null>(null)

/** Opens the window on what came: a folder's files, or a zip, whose index is read first. */
async function start(input: { files: TreeFile[] } | { zip: File }) {
  source.value = null
  readProblem.value = null
  runProblem.value = null
  sent.value = 0
  merge.value = 'new'
  target.value = props.targetId ?? 'top'
  open.value = true
  if ('files' in input) {
    source.value = { kind: 'folder', files: input.files }
    return
  }
  reading.value = true
  try {
    const entries = await readZipIndex(input.zip)
    source.value = { kind: 'zip', zip: input.zip, entries }
  } catch (error) {
    readProblem.value =
      error instanceof ZipError ? t(`treeUpload.zip.${error.problem}`) : t('treeUpload.zip.broken')
  } finally {
    reading.value = false
  }
}
defineExpose({ start })

const items = computed<Item[]>(() => {
  const s = source.value
  if (!s) return []
  if (s.kind === 'folder') return s.files
  return s.entries
    .filter((e) => !e.directory)
    .map((entry) => ({
      path: entry.name,
      size: entry.size,
      type: declaredTypeOf({ name: entry.name, type: '' }) ?? '',
      entry,
    }))
})
const limits = computed(
  () => uploads.limits.value ?? { maxImageBytes: Infinity, maxVideoBytes: Infinity },
)
const targetId = computed(() => (target.value === 'top' ? null : target.value))
const planned = computed(() => {
  // an empty folder or zip goes through too: the plan says there is nothing to send
  if (!source.value) return null
  try {
    return {
      plan: planTree(items.value, {
        existing: props.folders,
        targetId: targetId.value,
        merge: merge.value === 'merge',
        limits: limits.value,
      }),
      problem: null,
    }
  } catch (error) {
    if (error instanceof TreeError) return { plan: null, problem: error.detail }
    throw error
  }
})
const plan = computed(() => planned.value?.plan ?? null)
const problemText = computed(() => {
  const p = planned.value?.problem
  if (!p) return null
  if (p.problem === 'unsafe') return t('treeUpload.problem.unsafe', { path: p.path })
  if (p.problem === 'name') return t('treeUpload.problem.name', { name: p.name })
  if (p.problem === 'files') return t('treeUpload.problem.files', { n: p.count, max: p.max })
  if (p.problem === 'depth')
    return t('treeUpload.problem.depth', { path: p.path, max: p.max, left: p.left })
  if (p.problem === 'folders') return t('treeUpload.problem.folders', { max: p.max })
  return t('treeUpload.problem.empty')
})

const targetItems = computed(() => [
  { value: 'top', label: t('treeUpload.top') },
  ...folderTree(props.folders).map((f) => ({
    value: f.id,
    label: f.path,
  })),
])
/** «in cima alla libreria», «in «Novembre»» */
const placeName = computed(() =>
  targetId.value === null
    ? t('treeUpload.inTop')
    : t('treeUpload.inFolder', {
        name: props.folders.find((f) => f.id === targetId.value)?.name ?? '',
      }),
)
const newFolders = computed(() => plan.value?.folders.filter((f) => !f.existingId).length ?? 0)
const summary = computed(() => {
  const p = plan.value
  if (!p) return ''
  const files = t('treeUpload.files', { n: p.files.length }, p.files.length)
  const size = formatBytes(p.bytes)
  return newFolders.value > 0
    ? t('treeUpload.summary', {
        folders: t('treeUpload.folders', { n: newFolders.value }, newFolders.value),
        files,
        size,
        place: placeName.value,
      })
    : t('treeUpload.summaryFilesOnly', { files, size, place: placeName.value })
})
/** The name it gets beside the one there: what «Crea» means. */
const clash = computed(() => {
  const name = plan.value?.clashes[0]
  if (!name) return null
  let fresh: string | undefined
  try {
    fresh = planTree(items.value, {
      existing: props.folders,
      targetId: targetId.value,
      merge: false,
      limits: limits.value,
    }).folders.find((f) => f.parentKey === null && f.key === name.toLocaleLowerCase('it'))?.name
  } catch {
    // «Crea» would not fit (too many folders): its name is only shown
  }
  return { name, fresh: fresh ?? name, more: (plan.value?.clashes.length ?? 1) - 1 }
})
const skippedShown = computed(() => plan.value?.skipped.slice(0, 20) ?? [])

// ---- sending: the folders, then the files, a zip's entries only when the uploads have room
const WAITING: readonly string[] = ['queued', 'hashing', 'uploading', 'offline']
const waiting = computed(() => uploads.items.value.filter((i) => WAITING.includes(i.state)).length)
/** «Ferma»: no more entries are opened; those already in the uploads go on (or are cancelled there) */
const stopped = ref(false)
function room(): Promise<void> {
  if (waiting.value < 2 || stopped.value) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch([waiting, stopped], ([n, halt]) => {
      if (n < 2 || halt) {
        stop()
        resolve()
      }
    })
  })
}

async function run() {
  const p = plan.value
  const s = source.value
  if (!p || !s || running.value) return
  running.value = true
  stopped.value = false
  runProblem.value = null
  const ids = new Map<string, string | null>()
  const base = org.api(`/workspaces/${encodeURIComponent(props.workspace.id)}/folders`)
  try {
    for (const f of p.folders) {
      const parentId = f.parentKey === null ? targetId.value : (ids.get(f.parentKey) ?? null)
      ids.set(
        f.key,
        f.existingId ?? (await call<Folder>('POST', base, { name: f.name, parentId })).id,
      )
    }
  } catch (error) {
    // the folders made so far stay, empty (D-110)
    runProblem.value = t('treeUpload.folderFailed', { reason: failure(error).message })
    running.value = false
    // the library reads its folders again: the plan then joins or renames around them
    emit('changed')
    return
  }
  const leftOut: string[] = []
  for (const f of p.files) {
    if (stopped.value) break
    const folderId = f.folderKey === null ? targetId.value : (ids.get(f.folderKey) ?? null)
    let file = f.item.file
    const entry = f.item.entry
    if (!file && entry && s.kind === 'zip') {
      await room()
      if (stopped.value) break
      const type = declaredTypeOf({ name: f.name, type: '' })
      const limit =
        type && kindOf(type) === 'video' ? limits.value.maxVideoBytes : limits.value.maxImageBytes
      try {
        file = await readZipEntry(s.zip, entry, { name: f.name, type: type ?? '', limit })
      } catch {
        // too big, or not as many bytes as the index says: that file alone is left out
        leftOut.push(f.item.path)
        continue
      }
    }
    // a zip's entry without a preview of its own: nothing keeps it in memory once sent
    // «Unisci»: a file already in its folder is not made again (D-120.2)
    if (file)
      await uploads.add([file], folderId, null, {
        preview: !entry,
        reuseInFolder: merge.value === 'merge',
      })
    sent.value += 1
  }
  running.value = false
  open.value = false
  const done = stopped.value
    ? t('treeUpload.stopped', { n: sent.value, total: p.files.length })
    : t('treeUpload.done', { n: sent.value }, sent.value)
  emit(
    'done',
    leftOut.length === 0
      ? done
      : `${done} ${t('treeUpload.leftOut', { left: leftOut.join(', ') })}`,
  )
}
const reasonText = (reason: SkipReason) => t(`treeUpload.skip.${reason}`)
const title = computed(() =>
  source.value?.kind === 'folder' ? t('treeUpload.titleFolder') : t('treeUpload.titleZip'),
)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!running"
    :close="!running"
    data-tree-upload
  >
    <template #body>
      <p v-if="reading" role="status" class="text-(--app-text-muted)">
        {{ $t('treeUpload.reading') }}
      </p>
      <p v-else-if="readProblem" role="alert" class="text-(--app-danger)">{{ readProblem }}</p>
      <form
        v-else-if="source"
        id="tree-upload"
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="run"
      >
        <UFormField :label="$t('treeUpload.target')" name="tree-target">
          <USelect
            v-model="target"
            :items="targetItems"
            :disabled="running"
            class="w-full"
            size="xl"
            icon="i-lucide-folder"
            data-tree-target
          />
        </UFormField>
        <fieldset v-if="clash" class="flex flex-col gap-2" data-tree-clash>
          <legend class="mb-2 text-sm font-medium">
            {{ $t('treeUpload.clash', { name: clash.name, place: placeName }) }}
          </legend>
          <URadioGroup
            v-model="merge"
            :disabled="running"
            :items="[
              { value: 'new', label: t('treeUpload.clashNew', { name: clash.fresh }) },
              { value: 'merge', label: t('treeUpload.clashMerge', { name: clash.name }) },
            ]"
            :ui="{ item: 'min-h-11 items-center' }"
          />
        </fieldset>
        <p v-if="problemText" role="alert" class="text-(--app-danger)" data-tree-problem>
          {{ problemText }}
        </p>
        <p v-else class="text-lg font-semibold text-pretty" data-tree-summary>{{ summary }}</p>
        <details v-if="plan && plan.skipped.length > 0" data-tree-skipped>
          <summary class="min-h-11 cursor-pointer py-2.5 text-sm text-(--app-text-muted)">
            {{ $t('treeUpload.skipped', { n: plan.skipped.length }, plan.skipped.length) }}
          </summary>
          <ul class="mt-1 flex flex-col gap-1 text-sm">
            <li v-for="s in skippedShown" :key="s.path" class="break-all">
              {{ s.path }} <span class="text-(--app-text-muted)">· {{ reasonText(s.reason) }}</span>
            </li>
            <li v-if="plan.skipped.length > skippedShown.length" class="text-(--app-text-muted)">
              {{ $t('treeUpload.skippedMore', { n: plan.skipped.length - skippedShown.length }) }}
            </li>
          </ul>
        </details>
        <p v-if="source?.kind === 'zip'" class="text-sm text-(--app-text-muted)">
          {{ $t('treeUpload.zipNote') }}
        </p>
        <p v-if="running" role="status" class="text-sm">
          {{ $t('treeUpload.running', { done: sent, n: plan?.files.length ?? 0 }) }}
        </p>
        <p v-if="runProblem" role="alert" class="text-(--app-danger)">{{ runProblem }}</p>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton
          type="submit"
          form="tree-upload"
          class="min-h-control"
          :disabled="!plan || reading"
          :loading="running"
          data-tree-go
        >
          {{ $t('treeUpload.go') }}
        </UButton>
        <UButton
          v-if="running"
          class="min-h-control"
          color="neutral"
          variant="outline"
          :disabled="stopped"
          data-tree-stop
          @click="stopped = true"
        >
          {{ $t('treeUpload.stop') }}
        </UButton>
        <UButton v-else class="min-h-control" color="neutral" variant="ghost" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
