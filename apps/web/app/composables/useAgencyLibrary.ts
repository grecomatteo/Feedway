import type { LibraryFile } from './useLibrary'

export type LibraryUse = 'all' | 'any' | 'scheduled' | 'draft' | 'unused'

export interface AgencyLibraryFilter {
  kind: 'all' | 'image' | 'video'
  /** a client's id, or null for every client */
  workspaceId: string | null
  use: LibraryUse
  q: string
}

/**
 * «Libreria» across the clients (screen 19, Matteo 20/11): the files of every active client whose
 * library the person uses, newest first, by pages, with how many photos and videos the filter
 * finds. The changes (tags, delete, «Riprova») go to the client's own routes.
 */
export function useAgencyLibrary(initial: { workspaceId: string | null }) {
  const org = useOrganization()
  const { call } = useApi()
  const filter = reactive<AgencyLibraryFilter>({
    kind: 'all',
    workspaceId: initial.workspaceId,
    use: 'all',
    q: '',
  })
  const files = ref<LibraryFile[]>([])
  const next = ref<string | null>(null)
  const counts = ref({ image: 0, video: 0 })
  const status = ref<'pending' | 'success' | 'error'>('pending')
  const loadingMore = ref(false)

  const query = (before?: string) => {
    const q = new URLSearchParams({ limit: '48' })
    if (before) q.set('before', before)
    if (filter.kind !== 'all') q.set('kind', filter.kind)
    if (filter.workspaceId) q.set('workspaceId', filter.workspaceId)
    if (filter.use !== 'all') q.set('use', filter.use)
    if (filter.q.trim()) q.set('q', filter.q.trim())
    return q.toString()
  }
  interface Page {
    items: LibraryFile[]
    next: string | null
    counts: { image: number; video: number }
  }

  // only the latest request writes: a slow answer of an older filter is dropped
  let asked = 0
  async function load() {
    const mine = ++asked
    status.value = 'pending'
    try {
      const page = await call<Page>('GET', org.api(`/media?${query()}`))
      if (mine !== asked) return
      files.value = page.items
      next.value = page.next
      counts.value = page.counts
      status.value = 'success'
    } catch {
      if (mine === asked) status.value = 'error'
    }
  }
  async function more(): Promise<boolean> {
    if (!next.value) return true
    const mine = asked
    loadingMore.value = true
    try {
      const page = await call<Page>('GET', org.api(`/media?${query(next.value)}`))
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
  let typing: ReturnType<typeof setTimeout> | undefined
  watch(
    () => [filter.kind, filter.workspaceId, filter.use],
    () => void load(),
  )
  watch(
    () => filter.q,
    () => {
      clearTimeout(typing)
      typing = setTimeout(() => void load(), 250)
    },
  )
  onMounted(() => void load())
  onBeforeUnmount(() => {
    clearTimeout(typing)
  })

  const base = (file: Pick<LibraryFile, 'workspaceId'>) =>
    org.api(`/workspaces/${encodeURIComponent(file.workspaceId)}`)
  const replace = (file: LibraryFile) => {
    files.value = files.value.map((f) => (f.id === file.id ? file : f))
  }
  async function refresh(file: LibraryFile) {
    const fresh = await call<LibraryFile>(
      'GET',
      `${base(file)}/media/${encodeURIComponent(file.id)}`,
    )
    replace(fresh)
    return fresh
  }
  async function saveTags(file: LibraryFile, tags: string[]) {
    const updated = await call<LibraryFile>(
      'PATCH',
      `${base(file)}/media/${encodeURIComponent(file.id)}`,
      { tags },
    )
    replace(updated)
    return updated
  }
  async function remove(file: LibraryFile) {
    await call('DELETE', `${base(file)}/media/${encodeURIComponent(file.id)}`)
    files.value = files.value.filter((f) => f.id !== file.id)
    const kind = file.kind === 'video' ? 'video' : 'image'
    counts.value = { ...counts.value, [kind]: Math.max(0, counts.value[kind] - 1) }
  }
  async function retry(file: LibraryFile) {
    const again = await call<LibraryFile>(
      'POST',
      `${base(file)}/media/${encodeURIComponent(file.id)}/retry`,
    )
    replace(again)
    return again
  }
  const fileUrl = (file: Pick<LibraryFile, 'id' | 'workspaceId'>, variant: string) =>
    `${base(file)}/media/${encodeURIComponent(file.id)}/file/${variant}`

  return {
    filter,
    files,
    next,
    counts,
    status,
    loadingMore,
    load,
    more,
    refresh,
    saveTags,
    remove,
    retry,
    fileUrl,
  }
}
