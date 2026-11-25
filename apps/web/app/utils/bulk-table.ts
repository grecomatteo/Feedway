import { nextType, typeOptions, type PostType } from './post-editor.ts'

// The table «In blocco» with no page around it (spec §11.6, plan 09 Task 10, P5): it lives in the
// browser until «Programma». One file is one row; «Unisci in un carosello» makes one row of the
// rows chosen; «Distribuisci sulle fasce libere» writes the free slots on the rows, in order.
// The composable wraps these with the uploads and the server; here they are plain, for the tests.

/** A file of a row: still on its way, in the library, or refused. */
export interface BulkFile {
  /** the upload's key, to follow it */
  key: string
  name: string
  kind: 'image' | 'video' | null
  /** once in the library */
  mediaId: string | null
  state: 'sending' | 'ready' | 'failed'
}

/** Where a row goes: one account, or the accounts of a saved group (§11.6). */
export type BulkTarget = { kind: 'account'; id: string } | { kind: 'group'; id: string } | null

export interface BulkWhen {
  localDate: string
  localTime: string
}

export interface BulkTableRow {
  key: string
  files: BulkFile[]
  type: PostType | null
  /** the person chose the type: it no longer follows the files */
  typeChosen: boolean
  caption: string
  target: BulkTarget
  /** null: the row stays a draft («Senza data») */
  when: BulkWhen | null
  selected: boolean
}

/** As `BULK_LIMITS.rows` of the contracts: 50 rows, so 50 files, at a time (§11.6). */
export const BULK_TABLE_MAX_ROWS = 50
/** A carousel takes 2 to 10 files (D-48, D-118). */
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 10

let counter = 0
const newKey = () => `row-${String((counter += 1))}`

/** A row for a file: it goes where the row before goes, so 20 files need one choice, not 20. */
export function rowOf(file: BulkFile, before: BulkTableRow | null): BulkTableRow {
  const files = [file]
  return {
    key: newKey(),
    files,
    type: nextType(null, false, files),
    typeChosen: false,
    caption: '',
    target: before?.target ?? null,
    when: null,
    selected: false,
  }
}

/** The row with a file of it changed (sent, ready, refused): its type follows the files. */
export function withFiles(row: BulkTableRow, files: BulkFile[]): BulkTableRow {
  return { ...row, files, type: nextType(row.type, row.typeChosen, files) }
}

export type MergeRefusal = 'few' | 'many' | 'video'

/**
 * «Unisci in un carosello»: the rows chosen become one, in the place of the first, with their
 * files in order; text, account and day are the first row's, or of the first that has them.
 */
export function mergeRows(
  rows: readonly BulkTableRow[],
  keys: ReadonlySet<string>,
): { rows: BulkTableRow[] } | { refused: MergeRefusal } {
  const chosen = rows.filter((r) => keys.has(r.key))
  const files = chosen.flatMap((r) => r.files)
  if (chosen.length < 2 || files.length < CAROUSEL_MIN) return { refused: 'few' }
  if (files.length > CAROUSEL_MAX) return { refused: 'many' }
  const first = chosen[0]
  if (!first) return { refused: 'few' }
  const merged: BulkTableRow = {
    key: newKey(),
    files,
    type: 'carousel',
    typeChosen: false,
    caption: chosen.find((r) => r.caption.trim() !== '')?.caption ?? '',
    target: chosen.find((r) => r.target !== null)?.target ?? null,
    when: chosen.find((r) => r.when !== null)?.when ?? null,
    selected: false,
  }
  const out: BulkTableRow[] = []
  for (const row of rows) {
    if (row.key === first.key) out.push(merged)
    else if (!keys.has(row.key)) out.push(row)
  }
  return { rows: out }
}

/** «Separa»: a carousel back to one row per file, each with the carousel's text and account. */
export function splitRow(rows: readonly BulkTableRow[], key: string): BulkTableRow[] {
  return rows.flatMap((row) => {
    if (row.key !== key || row.files.length < 2) return [row]
    return row.files.map((file, index) => ({
      ...rowOf(file, row),
      caption: row.caption,
      when: index === 0 ? row.when : null,
    }))
  })
}

/**
 * «Distribuisci sulle fasce libere» (Scelta 7): the slots, in order, on the rows chosen, or on
 * every row when none is; the rows past the last slot keep their day. The server does not know
 * the table, so a slot another row already holds is skipped. `left` says how many rows got none.
 */
export function distribute(
  rows: readonly BulkTableRow[],
  slots: readonly BulkWhen[],
): { rows: BulkTableRow[]; left: number } {
  const writes = writesOn(rows)
  const held = new Set(rows.filter((r) => !writes(r) && r.when).map((r) => whenKey(r.when)))
  const free = slots.filter((s) => !held.has(whenKey(s)))
  let next = 0
  let left = 0
  const out = rows.map((row) => {
    if (!writes(row)) return row
    const slot = free[next]
    if (!slot) {
      left += 1
      return row
    }
    next += 1
    return { ...row, when: { localDate: slot.localDate, localTime: slot.localTime } }
  })
  return { rows: out, left }
}

const whenKey = (w: BulkWhen | null) => (w ? `${w.localDate} ${w.localTime}` : '')
const writesOn = (rows: readonly BulkTableRow[]) => {
  const anyChosen = rows.some((r) => r.selected)
  return (row: BulkTableRow) => !anyChosen || row.selected
}

/** How many rows «Distribuisci» writes on: the chosen ones, or all. */
export const distributeCount = (rows: readonly BulkTableRow[]) => rows.filter(writesOn(rows)).length

/**
 * How many slots to ask the server for: one per row written on, plus one per slot the other rows
 * hold, which `distribute` skips.
 */
export function distributeAsk(rows: readonly BulkTableRow[]): number {
  const writes = writesOn(rows)
  const held = new Set(rows.filter((r) => !writes(r) && r.when).map((r) => whenKey(r.when)))
  return distributeCount(rows) + held.size
}

/** What keeps a row from being sent; the server checks the rest and the row stays a draft. */
export type RowProblem = 'sending' | 'fileFailed' | 'noTarget' | 'type'

export function rowProblem(row: BulkTableRow): RowProblem | null {
  if (row.files.some((f) => f.state === 'failed')) return 'fileFailed'
  if (row.files.some((f) => f.state === 'sending' || f.mediaId === null)) return 'sending'
  if (row.target === null) return 'noTarget'
  if (row.type === null || !typeOptions(row.files).some((o) => o.type === row.type && o.enabled))
    return 'type'
  return null
}

/** A group's accounts that can still be chosen, in order; an account as itself. */
export function accountsOf(
  target: BulkTarget,
  groups: readonly { id: string; accountIds: string[]; unavailableAccountIds: string[] }[],
  pickable: ReadonlySet<string>,
): string[] {
  if (target === null) return []
  if (target.kind === 'account') return pickable.has(target.id) ? [target.id] : []
  const group = groups.find((g) => g.id === target.id)
  if (!group) return []
  const off = new Set(group.unavailableAccountIds)
  return group.accountIds.filter((id) => !off.has(id) && pickable.has(id))
}

/** The body of a row for «Programma» (`BulkRowBody` of the contracts). */
export function requestRow(row: BulkTableRow, accountIds: readonly string[]) {
  return {
    type: row.type ?? 'photo',
    mediaIds: row.files.map((f) => f.mediaId).filter((id): id is string => id !== null),
    caption: { common: row.caption },
    destinations: accountIds.map((accountId) => ({ accountId })),
    when: row.when,
  }
}
