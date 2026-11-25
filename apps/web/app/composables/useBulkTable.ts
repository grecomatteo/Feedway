import type { AccountGroupDto, BulkImportResponse } from '@app/contracts'
import type { UploadItem } from '~/composables/useUploads'
import { selectable, reconnecting } from '~/composables/usePostEditor'
import {
  BULK_TABLE_MAX_ROWS,
  accountsOf,
  distribute as distributeOn,
  distributeAsk,
  distributeCount,
  mergeRows,
  requestRow,
  rowOf,
  rowProblem,
  splitRow,
  withFiles,
  type BulkFile,
  type BulkTableRow,
  type BulkTarget,
  type MergeRefusal,
  type RowProblem,
} from '~/utils/bulk-table'

/**
 * «In blocco» (spec §11.6, plan 09 Task 10, P5): the files of the computer become the rows of a
 * table that lives here until «Programma»; then the server keeps them and makes the posts one
 * by one, and the page follows the import until its summary, with «Annulla» for 10 seconds.
 */
export function useBulkTable(opts: {
  client: Ref<WorkspaceView>
  profiles: Ref<WorkspaceProfile[]>
  groups: Ref<AccountGroupDto[] | null>
}) {
  const org = useOrganization()
  const { call, failure } = useApi()
  const workspaceId = opts.client.value.id
  const base = org.api(`/workspaces/${encodeURIComponent(workspaceId)}`)
  const uploads = useUploads(workspaceId, { shown: true })

  const rows = ref<BulkTableRow[]>([])
  /** the files the browser refused, said once with why */
  const refused = ref<UploadItem[]>([])
  /** files past the 50 of a table, not sent */
  const leftOut = ref(0)

  // ---- the files: one row each, their state followed from the uploads
  const fileOf = (item: UploadItem): BulkFile => ({
    key: item.key,
    name: item.name,
    kind: item.kind,
    mediaId: item.state === 'ready' ? (item.media?.id ?? null) : null,
    state:
      item.state === 'ready'
        ? 'ready'
        : ['failed', 'error', 'rejected'].includes(item.state)
          ? 'failed'
          : 'sending',
  })
  const itemOf = (key: string) => uploads.items.value.find((i) => i.key === key) ?? null
  watch(
    () => uploads.items.value.map((i) => `${i.key}:${i.state}:${i.media?.id ?? ''}`).join(','),
    () => {
      rows.value = rows.value.map((row) => {
        const files = row.files.map((f) => {
          const item = itemOf(f.key)
          return item ? fileOf(item) : f
        })
        const same = files.every((f, i) => {
          const before = row.files.at(i)
          return f.state === before?.state && f.mediaId === before.mediaId
        })
        return same ? row : withFiles(row, files)
      })
    },
  )

  const room = computed(() => Math.max(0, BULK_TABLE_MAX_ROWS - rows.value.length))
  async function addFiles(list: readonly File[]) {
    if (list.length === 0) return
    const free = room.value
    const items = await uploads.add(list.slice(0, free), null, null, { room: free })
    leftOut.value = Math.max(0, list.length - free)
    refused.value = items.filter((i) => i.state === 'rejected')
    for (const item of items) {
      if (item.state === 'rejected') continue
      rows.value.push(rowOf(fileOf(item), rows.value.at(-1) ?? null))
    }
  }

  function removeRow(key: string) {
    const row = rows.value.find((r) => r.key === key)
    for (const f of row?.files ?? []) {
      const item = itemOf(f.key)
      // a file still on its way stops; one already in the library stays there
      if (item && !item.media) void uploads.cancel(item)
    }
    rows.value = rows.value.filter((r) => r.key !== key)
  }
  const change = (key: string, patch: Partial<BulkTableRow>) => {
    rows.value = rows.value.map((r) => (r.key === key ? { ...r, ...patch } : r))
  }

  // ---- choosing rows, «Unisci in un carosello», «Separa»
  const chosen = computed(() => rows.value.filter((r) => r.selected))
  const allChosen = computed(
    () => rows.value.length > 0 && chosen.value.length === rows.value.length,
  )
  function chooseAll(on: boolean) {
    rows.value = rows.value.map((r) => ({ ...r, selected: on }))
  }
  const mergeRefused = ref<MergeRefusal | null>(null)
  function merge() {
    const out = mergeRows(rows.value, new Set(chosen.value.map((r) => r.key)))
    if ('refused' in out) {
      mergeRefused.value = out.refused
      return
    }
    mergeRefused.value = null
    rows.value = out.rows
  }
  function split(key: string) {
    rows.value = splitRow(rows.value, key)
  }
  /** «Account» for the rows chosen, or every row when none is */
  function targetAll(target: BulkTarget) {
    const any = chosen.value.length > 0
    rows.value = rows.value.map((r) => (!any || r.selected ? { ...r, target } : r))
  }

  // ---- «Distribuisci sulle fasce libere»: the server says the free slots, in order
  const slotState = ref<'idle' | 'asking' | 'none' | 'short' | 'failed'>('idle')
  const slotsLeft = ref(0)
  async function distribute() {
    if (distributeCount(rows.value) === 0) return
    // written plus held is at most the rows, and the table holds at most 50 (the server's limit)
    const count = distributeAsk(rows.value)
    slotState.value = 'asking'
    try {
      const { slots } = await call<{
        slots: { at: string; localDate: string; localTime: string }[]
      }>('GET', `${base}/free-slots?count=${String(count)}`)
      if (slots.length === 0) {
        slotState.value = 'none'
        return
      }
      const out = distributeOn(rows.value, slots)
      rows.value = out.rows
      slotsLeft.value = out.left
      slotState.value = out.left > 0 ? 'short' : 'idle'
    } catch {
      slotState.value = 'failed'
    }
  }

  // ---- the accounts: one, or a saved group (§11.6)
  const accounts = computed(() =>
    opts.profiles.value.flatMap((p) =>
      p.accounts.map((a) => ({
        a,
        off: !selectable(a) || reconnecting(opts.client.value, p.key),
      })),
    ),
  )
  const pickable = computed(() => new Set(accounts.value.filter((x) => !x.off).map((x) => x.a.id)))
  const accountsOfRow = (row: BulkTableRow) =>
    accountsOf(row.target, opts.groups.value ?? [], pickable.value)

  // ---- «Programma»
  const problems = computed(() => {
    const out = new Map<string, RowProblem>()
    for (const row of rows.value) {
      const p = rowProblem(row)
      if (p) out.set(row.key, p)
      else if (accountsOfRow(row).length === 0) out.set(row.key, 'noTarget')
    }
    return out
  })
  const firstProblem = computed(() => {
    for (const row of rows.value) {
      const p = problems.value.get(row.key)
      if (p) return { key: row.key, problem: p }
    }
    return null
  })
  const undated = computed(() => rows.value.filter((r) => r.when === null).length)

  const result = ref<BulkImportResponse | null>(null)
  /** the import can no longer be read (access taken away, client gone): it is not followed */
  const followProblem = ref<string | null>(null)
  const sending = ref(false)
  const sendProblem = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let alive = true
  onBeforeUnmount(() => {
    alive = false
    clearTimeout(timer)
  })

  async function schedule() {
    if (rows.value.length === 0 || firstProblem.value || sending.value) return
    sending.value = true
    sendProblem.value = null
    try {
      result.value = await call<BulkImportResponse>('POST', `${base}/bulk-imports`, {
        source: 'files',
        rows: rows.value.map((r) => requestRow(r, accountsOfRow(r))),
      })
      follow()
    } catch (e) {
      sendProblem.value = failure(e).message
    } finally {
      sending.value = false
    }
  }

  /**
   * The import, read again until it is done: often at first, more slowly while it waits in the
   * queue, about every second once it runs, so «Annulla» comes with most of its 10 seconds.
   */
  function follow(wait = 800) {
    clearTimeout(timer)
    const current = result.value
    if (!alive || !current || current.status === 'done' || current.status === 'undone') return
    timer = setTimeout(() => void read(current.id, wait), wait)
  }
  async function read(id: string, wait: number) {
    try {
      result.value = await call<BulkImportResponse>(
        'GET',
        `${base}/bulk-imports/${encodeURIComponent(id)}`,
      )
    } catch (e) {
      const f = failure(e)
      // no answer, or the server's trouble: tried again, the import goes on on the server;
      // a refusal stays one, so it is said and the reading stops
      if (f.status >= 400 && f.status < 500 && f.status !== 408 && f.status !== 429) {
        followProblem.value = f.message
        return
      }
    }
    follow(Math.min(wait * 1.25, result.value?.status === 'running' ? 1000 : 4000))
  }

  const undoing = ref(false)
  const undoProblem = ref<string | null>(null)
  async function undo() {
    const current = result.value
    if (!current || undoing.value) return
    undoing.value = true
    undoProblem.value = null
    try {
      result.value = await call<BulkImportResponse>(
        'POST',
        `${base}/bulk-imports/${encodeURIComponent(current.id)}/undo`,
      )
    } catch (e) {
      undoProblem.value = failure(e).message
    } finally {
      undoing.value = false
    }
  }

  /** «Ricomincia» after «Annulla»: the table as it was, for another «Programma» */
  function again() {
    result.value = null
    undoProblem.value = null
    followProblem.value = null
  }

  return {
    uploads,
    rows,
    refused,
    leftOut,
    room,
    addFiles,
    removeRow,
    change,
    chosen,
    allChosen,
    chooseAll,
    merge,
    mergeRefused,
    split,
    targetAll,
    distribute,
    slotState,
    slotsLeft,
    accounts,
    accountsOfRow,
    problems,
    firstProblem,
    undated,
    schedule,
    sending,
    sendProblem,
    result,
    followProblem,
    undo,
    undoing,
    undoProblem,
    again,
    itemOf,
  }
}

export type BulkTable = ReturnType<typeof useBulkTable>
