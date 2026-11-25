import { describe, expect, test } from 'vitest'
import {
  BULK_UNDO_WINDOW_MS,
  bulkSummary,
  bulkUndoUntil,
  canUndoBulk,
  type BulkRowOutcome,
} from './bulk.js'

// The rules of an import in bulk (spec §11.6, plan 09 Task 10, P5).
const scheduled: BulkRowOutcome = { status: 'scheduled', postId: 'p1', version: 2 }
const draft: BulkRowOutcome = {
  status: 'draft',
  postId: 'p2',
  version: 1,
  reason: 'blocked',
  codes: ['caption_too_long'],
}
const failed: BulkRowOutcome = { status: 'failed', code: 'not_found' }

describe('bulkSummary', () => {
  test('«18 programmati, 2 da sistemare»: each outcome counted once, rows still to do nowhere', () => {
    const rows = [...Array<BulkRowOutcome>(18).fill(scheduled), draft, draft, failed, null]
    expect(bulkSummary(rows)).toEqual({ scheduled: 18, drafts: 2, failed: 1, removed: 0, kept: 0 })
  })

  test('after «Annulla», the posts removed and those kept', () => {
    expect(
      bulkSummary([{ ...scheduled, undo: 'removed' }, { ...draft, undo: 'kept' }, failed]),
    ).toEqual({ scheduled: 1, drafts: 1, failed: 1, removed: 1, kept: 1 })
  })
})

describe('«Annulla»', () => {
  const end = new Date('2026-12-01T10:00:00Z')

  test('open for 10 seconds after the end of a done import', () => {
    expect(bulkUndoUntil('done', end)).toEqual(new Date(end.getTime() + BULK_UNDO_WINDOW_MS))
    expect(canUndoBulk('done', end, new Date('2026-12-01T10:00:09.999Z'))).toBe(true)
    expect(canUndoBulk('done', end, new Date('2026-12-01T10:00:10Z'))).toBe(false)
  })

  test('never for an import not done or already undone', () => {
    for (const status of ['pending', 'running', 'undone'] as const) {
      expect(bulkUndoUntil(status, end)).toBeNull()
      expect(canUndoBulk(status, end, end)).toBe(false)
    }
    expect(canUndoBulk('done', null, end)).toBe(false)
  })
})
