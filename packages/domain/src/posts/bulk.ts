// Programming in bulk (spec §11.6, plan 09 Task 10, P5): the table lives in the panel until
// «Programma»; then the server keeps the rows of one import with the outcome of each, written in
// the same transaction as the post it created. These are the import's rules, without the
// database: how many rows, how long «Annulla» lasts, what the summary counts.

/** At most this many rows in one import (Scelta 7): one file is one post. */
export const BULK_MAX_ROWS = 50

/** «Annulla» of an import is offered for this long after its end (P5), checked by the server. */
export const BULK_UNDO_WINDOW_MS = 10_000

/** «Duplica» copies a post on at most this many dates (Scelta 9). */
export const DUPLICATE_MAX_DATES = 31

/** Where the rows came from: the files of the table, a sheet, a post duplicated. */
export const BULK_SOURCES = ['files', 'csv', 'duplicate'] as const
export type BulkSource = (typeof BULK_SOURCES)[number]

/** `pending` until the worker takes it, `running` row by row, `done`, `undone` by «Annulla». */
export const BULK_STATUSES = ['pending', 'running', 'done', 'undone'] as const
export type BulkStatus = (typeof BULK_STATUSES)[number]

/**
 * Why a row stayed a draft: it was asked as a draft (`asked`, «Duplica» without «e programma»),
 * its checks block or wait for a choice (`blocked`), it has no date (`no_date`), the agency's
 * posts of that day are at their limit (`limit_reached`), the person may no longer schedule in
 * the client (`not_allowed`).
 */
export const BULK_DRAFT_REASONS = [
  'asked',
  'blocked',
  'no_date',
  'limit_reached',
  'not_allowed',
] as const
export type BulkDraftReason = (typeof BULK_DRAFT_REASONS)[number]

/** How many rule codes a draft row keeps: the editor shows them all when it is opened. */
export const BULK_ROW_CODES_MAX = 5

/**
 * The outcome of one row: the post scheduled, the draft with why, or the failure with its code
 * (the row created nothing). `version` is the post's at its creation: «Annulla» touches a post
 * only while it is still that one. `undo` is what «Annulla» did with the row's post.
 */
export type BulkRowOutcome =
  | { status: 'scheduled'; postId: string; version: number; undo?: BulkRowUndo }
  | {
      status: 'draft'
      postId: string
      version: number
      reason: BulkDraftReason
      /** the codes of the blocks and of the warnings without a choice, at most 5 */
      codes: string[]
      undo?: BulkRowUndo
    }
  | { status: 'failed'; code: string }

/** «Annulla» of a row: its post deleted, or kept because someone touched it since. */
export type BulkRowUndo = 'removed' | 'kept'

export interface BulkSummary {
  scheduled: number
  drafts: number
  failed: number
  /** after «Annulla»: the posts deleted and those kept */
  removed: number
  kept: number
}

/** The counts of the outcomes so far; a row without an outcome counts nowhere. */
export function bulkSummary(outcomes: readonly (BulkRowOutcome | null)[]): BulkSummary {
  const summary: BulkSummary = { scheduled: 0, drafts: 0, failed: 0, removed: 0, kept: 0 }
  for (const o of outcomes) {
    if (o === null) continue
    if (o.status === 'failed') {
      summary.failed += 1
      continue
    }
    if (o.status === 'scheduled') summary.scheduled += 1
    else summary.drafts += 1
    if (o.undo === 'removed') summary.removed += 1
    else if (o.undo === 'kept') summary.kept += 1
  }
  return summary
}

/** Until when «Annulla» is offered; null while the import is not done. */
export function bulkUndoUntil(status: BulkStatus, finishedAt: Date | null): Date | null {
  if (status !== 'done' || finishedAt === null) return null
  return new Date(finishedAt.getTime() + BULK_UNDO_WINDOW_MS)
}

/** «Annulla» is still possible: the import is done and its window is open. */
export function canUndoBulk(status: BulkStatus, finishedAt: Date | null, now: Date): boolean {
  const until = bulkUndoUntil(status, finishedAt)
  return until !== null && now < until
}
