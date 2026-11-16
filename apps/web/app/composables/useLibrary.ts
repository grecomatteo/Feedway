import type { LibraryFolder, MediaDto } from '@app/contracts'

export type LibraryFile = MediaDto
export type Folder = LibraryFolder

export interface LibraryFilter {
  kind: 'all' | 'image' | 'video'
  /** null: every file; `none`: the files in no folder; else a folder's id */
  folder: string | null
  tag: string | null
  q: string
}

/** Whether the person may use the workspace's library: Editor and above (spec §10.2). */
export const usesLibrary = (w: Pick<WorkspaceView, 'myRole'>) => w.myRole !== 'viewer'

/**
 * The library of one workspace (spec §11.8, plan 04 Task 12): its folders, a page of its files
 * narrowed by the filter, and what changes them. Pages are asked with «Mostra altri» (`before`).
 */
export function useLibrary(workspaceId: Ref<string>) {
  const org = useOrganization()
  const { call } = useApi()
  const base = computed(() => org.api(`/workspaces/${encodeURIComponent(workspaceId.value)}`))

  const filter = reactive<LibraryFilter>({ kind: 'all', folder: null, tag: null, q: '' })
  const files = ref<LibraryFile[]>([])
  const next = ref<string | null>(null)
  const usedBytes = ref(0)
  const tags = ref<string[]>([])
  const status = ref<'pending' | 'success' | 'error'>('pending')
  const loadingMore = ref(false)
  const folders = ref<Folder[]>([])

  const query = (before?: string) => {
    const q = new URLSearchParams({ limit: '48' })
    if (before) q.set('before', before)
    if (filter.kind !== 'all') q.set('kind', filter.kind)
    if (filter.folder) q.set('folder', filter.folder)
    if (filter.tag) q.set('tag', filter.tag)
    if (filter.q.trim()) q.set('q', filter.q.trim())
    return q.toString()
  }
  interface Page {
    items: LibraryFile[]
    next: string | null
    usedBytes: number
    tags: string[]
  }

  // only the latest request writes: a slow answer of an older filter is dropped
  let asked = 0
  async function load() {
    const mine = ++asked
    status.value = 'pending'
    try {
      const [page, list] = await Promise.all([
        call<Page>('GET', `${base.value}/media?${query()}`),
        call<{ items: Folder[] }>('GET', `${base.value}/folders`),
      ])
      if (mine !== asked) return
      files.value = page.items
      next.value = page.next
      usedBytes.value = page.usedBytes
      tags.value = page.tags
      folders.value = list.items
      status.value = 'success'
    } catch {
      if (mine === asked) status.value = 'error'
    }
  }
  /** The next page; false when it could not be read. A page of a filter changed meanwhile goes. */
  async function more(): Promise<boolean> {
    if (!next.value) return true
    const mine = asked
    loadingMore.value = true
    try {
      const page = await call<Page>('GET', `${base.value}/media?${query(next.value)}`)
      if (mine !== asked) return true
      files.value = [...files.value, ...page.items]
      next.value = page.next
      return true
    } catch {
      return false
    } finally {
      loadingMore.value = false
    }
  }
  async function reloadFolders() {
    folders.value = (await call<{ items: Folder[] }>('GET', `${base.value}/folders`)).items
  }

  let typing: ReturnType<typeof setTimeout> | undefined
  watch(
    () => [filter.kind, filter.folder, filter.tag],
    () => void load(),
  )
  watch(
    () => filter.q,
    () => {
      clearTimeout(typing)
      typing = setTimeout(() => void load(), 250)
    },
  )
  watch(workspaceId, () => {
    Object.assign(filter, { kind: 'all', folder: null, tag: null, q: '' })
    void load()
  })
  onMounted(() => void load())
  onBeforeUnmount(() => {
    clearTimeout(typing)
  })

  /** Changes a file's folder or tags; the list follows (a file moved out of the folder shown goes). */
  async function update(file: LibraryFile, change: { folderId?: string | null; tags?: string[] }) {
    const updated = await call<LibraryFile>(
      'PATCH',
      `${base.value}/media/${encodeURIComponent(file.id)}`,
      change,
    )
    const stays =
      (filter.folder === null ||
        (filter.folder === 'none'
          ? updated.folderId === null
          : updated.folderId === filter.folder)) &&
      (filter.tag === null || updated.tags.includes(filter.tag))
    files.value = stays
      ? files.value.map((f) => (f.id === updated.id ? updated : f))
      : files.value.filter((f) => f.id !== updated.id)
    if (change.tags) tags.value = [...new Set([...tags.value, ...updated.tags])].sort()
    if (change.folderId !== undefined) await reloadFolders()
    return updated
  }
  async function remove(file: LibraryFile) {
    await call('DELETE', `${base.value}/media/${encodeURIComponent(file.id)}`)
    files.value = files.value.filter((f) => f.id !== file.id)
    await reloadFolders()
  }
  async function createFolder(name: string, parentId: string | null) {
    const folder = await call<Folder>('POST', `${base.value}/folders`, { name, parentId })
    await reloadFolders()
    return folder
  }
  async function renameFolder(folder: Folder, name: string) {
    await call('PATCH', `${base.value}/folders/${encodeURIComponent(folder.id)}`, { name })
    await reloadFolders()
  }
  async function deleteFolder(folder: Folder) {
    await call('DELETE', `${base.value}/folders/${encodeURIComponent(folder.id)}?confirm=true`)
    if (filter.folder === folder.id) filter.folder = folder.parentId
    await load()
  }

  /** A copy of a file for the panel: the player asks the preview by ranges. */
  const fileUrl = (file: Pick<LibraryFile, 'id'>, variant: string) =>
    `${base.value}/media/${encodeURIComponent(file.id)}/file/${variant}`

  return {
    filter,
    files,
    next,
    usedBytes,
    tags,
    status,
    loadingMore,
    folders,
    load,
    more,
    update,
    remove,
    createFolder,
    renameFolder,
    deleteFolder,
    fileUrl,
  }
}

/** The folders as a tree, flattened in reading order, each with its depth. */
export function folderTree(folders: readonly Folder[]): (Folder & { depth: number })[] {
  const out: (Folder & { depth: number })[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId)) {
      out.push({ ...f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** The image that stands for a file in a grid: its thumbnail, else its photo copy. */
export function thumbnailOf(file: LibraryFile): string | null {
  const purposes = file.variants.map((v) => v.purpose)
  if (purposes.includes('thumbnail')) return 'thumbnail'
  if (file.kind === 'image' && purposes.includes('ig_feed')) return 'ig_feed'
  return null
}
