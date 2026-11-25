import { describe, expect, test } from 'vitest'
import {
  accountsOf,
  distribute,
  distributeAsk,
  distributeCount,
  mergeRows,
  requestRow,
  rowOf,
  rowProblem,
  splitRow,
  targetOf,
  withFiles,
  type BulkFile,
  type BulkTableRow,
} from '../app/utils/bulk-table.ts'

// The table «In blocco» (spec §11.6, plan 09 Task 10): one file one row, «Unisci in un
// carosello», «Distribuisci sulle fasce libere», what keeps a row back and the body it sends.

const photo = (n: number): BulkFile => ({
  key: `f${String(n)}`,
  name: `pane-${String(n)}.jpg`,
  kind: 'image',
  mediaId: `m${String(n)}`,
  state: 'ready',
})
const video: BulkFile = { ...photo(9), name: 'forno.mp4', kind: 'video' }

/** The row at `i`, or the test stops there. */
function at(rows: readonly BulkTableRow[], i: number): BulkTableRow {
  const row = rows[i]
  if (!row) throw new Error(`no row ${String(i)}`)
  return row
}

function table(n: number): BulkTableRow[] {
  const rows: BulkTableRow[] = []
  for (let i = 1; i <= n; i += 1) rows.push(rowOf(photo(i), rows.at(-1) ?? null))
  return rows
}

describe('a row per file', () => {
  test('a photo is a photo, a video a reel; the account of the row before is kept', () => {
    const first = { ...rowOf(photo(1), null), target: { kind: 'account', id: 'ig' } as const }
    const second = rowOf(video, first)
    expect(first.type).toBe('photo')
    expect(second).toMatchObject({ type: 'reel', target: { kind: 'account', id: 'ig' } })
  })

  test('the type follows the files until the person chooses one', () => {
    const row = rowOf({ ...photo(1), kind: null, state: 'sending', mediaId: null }, null)
    expect(withFiles(row, [video]).type).toBe('reel')
    expect(withFiles({ ...row, type: 'story', typeChosen: true }, [video]).type).toBe('story')
  })
})

describe('«Unisci in un carosello»', () => {
  test('the rows chosen become one carousel in the place of the first', () => {
    const rows = table(4)
    rows[1] = { ...at(rows, 1), caption: 'Pane del giorno' }
    rows[2] = { ...at(rows, 2), when: { localDate: '2027-01-04', localTime: '12:00' } }
    const merged = mergeRows(rows, new Set([at(rows, 1).key, at(rows, 2).key]))
    if (!('rows' in merged)) throw new Error('refused')
    expect(merged.rows).toHaveLength(3)
    expect(merged.rows[1]).toMatchObject({
      type: 'carousel',
      caption: 'Pane del giorno',
      when: { localDate: '2027-01-04', localTime: '12:00' },
    })
    expect(merged.rows[1]?.files.map((f) => f.name)).toEqual(['pane-2.jpg', 'pane-3.jpg'])
    expect(merged.rows[0]?.key).toBe(rows[0]?.key)
  })

  test('one row, or more than 10 files, is refused with why', () => {
    const rows = table(11)
    expect(mergeRows(rows, new Set([at(rows, 0).key]))).toEqual({ refused: 'few' })
    expect(mergeRows(rows, new Set(rows.map((r) => r.key)))).toEqual({ refused: 'many' })
  })

  test('«Separa» gives one row per file back, with the text', () => {
    const rows = table(3)
    const merged = mergeRows(rows, new Set(rows.map((r) => r.key)))
    if (!('rows' in merged)) throw new Error('refused')
    const carousel = { ...at(merged.rows, 0), caption: 'Tre pani' }
    const split = splitRow([carousel], carousel.key)
    expect(split.map((r) => [r.type, r.caption, r.files.length])).toEqual([
      ['photo', 'Tre pani', 1],
      ['photo', 'Tre pani', 1],
      ['photo', 'Tre pani', 1],
    ])
  })
})

describe('«Distribuisci sulle fasce libere»', () => {
  const slots = [
    { localDate: '2027-01-04', localTime: '12:00' },
    { localDate: '2027-01-05', localTime: '12:00' },
  ]

  test('on every row in order when none is chosen; the rows past the last slot keep theirs', () => {
    const rows = table(3)
    expect(distributeCount(rows)).toBe(3)
    const out = distribute(rows, slots)
    expect(out.rows.map((r) => r.when?.localDate ?? null)).toEqual([
      '2027-01-04',
      '2027-01-05',
      null,
    ])
    expect(out.left).toBe(1)
  })

  test('only on the rows chosen', () => {
    const rows = table(3).map((r, i) => ({ ...r, selected: i > 0 }))
    expect(distributeCount(rows)).toBe(2)
    expect(distribute(rows, slots).rows.map((r) => r.when?.localDate ?? null)).toEqual([
      null,
      '2027-01-04',
      '2027-01-05',
    ])
  })

  test('a slot a row already holds is not given again: twice on rows chosen, or a day by hand', () => {
    const three = [...slots, { localDate: '2027-01-06', localTime: '12:00' }]
    // the first row got 4 January the first time; now the other two are chosen
    const rows = table(3).map((r, i) =>
      i === 0
        ? { ...r, when: { localDate: '2027-01-04', localTime: '12:00' } }
        : { ...r, selected: true },
    )
    // the server does not know the table: it is asked for one more, for the slot the table holds
    expect(distributeAsk(rows)).toBe(3)
    expect(distribute(rows, three).rows.map((r) => r.when?.localDate ?? null)).toEqual([
      '2027-01-04',
      '2027-01-05',
      '2027-01-06',
    ])
  })

  test('the rows it writes on give their slot back', () => {
    const rows = table(2).map((r) => ({
      ...r,
      when: { localDate: '2027-01-04', localTime: '12:00' },
    }))
    expect(distributeAsk(rows)).toBe(2)
    expect(distribute(rows, slots).rows.map((r) => r.when?.localDate ?? null)).toEqual([
      '2027-01-04',
      '2027-01-05',
    ])
  })
})

test("a sheet's row goes to no account, one, or several", () => {
  expect(targetOf([])).toBeNull()
  expect(targetOf(['ig'])).toEqual({ kind: 'account', id: 'ig' })
  expect(targetOf(['ig', 'fb'])).toEqual({ kind: 'accounts', ids: ['ig', 'fb'] })
})

describe('what keeps a row back', () => {
  const ready = { ...rowOf(photo(1), null), target: { kind: 'account', id: 'ig' } as const }

  test('a file on its way, a file refused, no account, a type the files do not take', () => {
    expect(rowProblem(ready)).toBeNull()
    expect(
      rowProblem({ ...ready, files: [{ ...photo(1), state: 'sending', mediaId: null }] }),
    ).toBe('sending')
    expect(rowProblem({ ...ready, files: [{ ...photo(1), state: 'failed' }] })).toBe('fileFailed')
    expect(rowProblem({ ...ready, target: null })).toBe('noTarget')
    expect(rowProblem({ ...ready, type: 'reel', typeChosen: true })).toBe('type')
  })

  test('no day is not a problem: the row stays a draft', () => {
    expect(rowProblem({ ...ready, when: null })).toBeNull()
  })
})

describe('the body of «Programma»', () => {
  const groups = [{ id: 'g', accountIds: ['ig', 'fb', 'old'], unavailableAccountIds: ['old'] }]
  const pickable = new Set(['ig', 'fb'])

  test('a group gives its accounts still there, in order; an account off gives none', () => {
    expect(accountsOf({ kind: 'group', id: 'g' }, groups, pickable)).toEqual(['ig', 'fb'])
    expect(accountsOf({ kind: 'account', id: 'old' }, groups, pickable)).toEqual([])
    expect(accountsOf(null, groups, pickable)).toEqual([])
  })

  test('the accounts a sheet names, those still there', () => {
    expect(accountsOf({ kind: 'accounts', ids: ['fb', 'old', 'ig'] }, groups, pickable)).toEqual([
      'fb',
      'ig',
    ])
  })

  test('a text of its own for a platform goes with the common one', () => {
    const row = { ...rowOf(photo(1), null), caption: 'Pane', captionInstagram: '#pane' }
    expect(requestRow(row, ['ig']).caption).toEqual({ common: 'Pane', instagram: '#pane' })
  })

  test('files, text, accounts and day', () => {
    const row = {
      ...rowOf(photo(1), null),
      caption: 'Pane',
      when: { localDate: '2027-01-04', localTime: '12:00' },
    }
    expect(requestRow(row, ['ig'])).toEqual({
      type: 'photo',
      mediaIds: ['m1'],
      caption: { common: 'Pane' },
      destinations: [{ accountId: 'ig' }],
      when: { localDate: '2027-01-04', localTime: '12:00' },
    })
  })
})
