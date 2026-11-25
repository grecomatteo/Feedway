import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  SHEET_TEMPLATE,
  columnsOf,
  filesAsked,
  parseCsv,
  parseSheetDate,
  parseSheetTime,
  parseXml,
  readSheet,
  sheetRows,
  type SheetAccount,
} from '../app/utils/sheet-import.ts'

// A sheet prepared elsewhere as rows of «In blocco» (spec §11.6 point 2, plan 09 Task 11, P6):
// a CSV of Excel in Italian and one of Google Sheets, an .xlsx as Excel writes it and one as
// Numbers does (dates from 1904, texts in the cells), with an unknown account and a missing file.

const sample = (name: string) =>
  new File([readFileSync(new URL(`./fixtures/sheets/${name}`, import.meta.url))], name)

const ACCOUNTS: SheetAccount[] = [
  { id: 'ig', platform: 'instagram', username: 'fornoluce', name: 'Forno Luce' },
  { id: 'fb', platform: 'facebook', username: null, name: 'Forno Luce' },
]

describe('CSV', () => {
  test('Excel in Italian: BOM, `;`, quotes with `;` and a new line inside', () => {
    const rows = parseCsv('﻿a;b\r\n"x; y";"due\r\nrighe"\r\n"con ""virgolette""";\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x; y', 'due\r\nrighe'],
      ['con "virgolette"', ''],
    ])
  })

  test('Google Sheets: `,` and no BOM; a `;` inside a text does not change the delimiter', () => {
    expect(parseCsv('a,b\n"uno; due",3\n')).toEqual([
      ['a', 'b'],
      ['uno; due', '3'],
    ])
  })
})

describe('days and times', () => {
  test('as text', () => {
    expect(parseSheetDate('02/12/2026', false)).toBe('2026-12-02')
    expect(parseSheetDate('2/3/2027', false)).toBe('2027-03-02')
    expect(parseSheetDate('2026-12-05', false)).toBe('2026-12-05')
    expect(parseSheetDate('31/02/2026', false)).toBeNull()
    expect(parseSheetDate('domani', false)).toBeNull()
    expect(parseSheetTime('9:15')).toBe('09:15')
    expect(parseSheetTime('18.00')).toBeNull()
    expect(parseSheetTime('25:00')).toBeNull()
  })

  test('as Excel numbers, from 1900 and from 1904', () => {
    expect(parseSheetDate('45658', false)).toBe('2025-01-01')
    expect(parseSheetDate('44196', true)).toBe('2025-01-01')
    expect(parseSheetDate('61', false)).toBe('1900-03-01')
    expect(parseSheetTime('0.5208333333333334')).toBe('12:30')
    expect(parseSheetTime('46364.75')).toBe('18:00')
  })
})

test('the columns in Italian or in English, whatever the case and the accents', () => {
  expect(
    columnsOf(['Data', 'ORA', 'Testo Instagram', 'caption_facebook', 'File', 'Account']),
  ).toEqual({ date: 0, time: 1, captionInstagram: 2, captionFacebook: 3, file: 4, account: 5 })
})

test('XML: entities, prefixes and rich text', () => {
  const root = parseXml('<?xml version="1.0"?><x:a k="&lt;1&gt;"><b>A &amp; B&#233;</b><c/></x:a>')
  const a = root.children[0]
  expect(a?.name).toBe('a')
  expect(a?.attrs['k']).toBe('<1>')
  expect(a?.children[0]?.text).toBe('A & Bé')
})

describe('the sample sheets', () => {
  test('Excel in Italian (CSV): an unknown account and an impossible day said with their row', async () => {
    const out = sheetRows(await readSheet(sample('excel-italiano.csv')), ACCOUNTS, 50)
    expect(out.rows).toEqual([
      {
        line: 2,
        when: { localDate: '2026-12-02', localTime: '12:30' },
        caption: 'Pane di segale; appena sfornato',
        captionInstagram: null,
        captionFacebook: null,
        accountIds: ['ig'],
        fileNames: ['pane.jpg'],
      },
      {
        line: 3,
        when: { localDate: '2026-12-03', localTime: '18:00' },
        caption: 'Tre focacce,\r\nuna per giorno',
        captionInstagram: '#focaccia',
        captionFacebook: 'Venite a provarle',
        accountIds: ['ig', 'fb'],
        fileNames: ['focaccia-1.jpg', 'focaccia-2.jpg'],
      },
    ])
    expect(out.problems).toEqual([
      { line: 4, problem: { code: 'account', value: '@sconosciuto' } },
      { line: 5, problem: { code: 'date', value: '31/02/2026' } },
    ])
  })

  test('Google Sheets (CSV): English names, a row without time at noon, one without day', async () => {
    const out = sheetRows(await readSheet(sample('google-fogli.csv')), ACCOUNTS, 50)
    expect(out.rows.map((r) => [r.when, r.caption])).toEqual([
      [{ localDate: '2026-12-05', localTime: '12:30' }, 'Rye bread, fresh'],
      [{ localDate: '2026-12-06', localTime: '12:00' }, 'Senza ora'],
      [null, 'Senza data'],
    ])
    expect(out.problems).toEqual([])
  })

  test('Excel (.xlsx): shared and rich texts, serial dates, a day and a time in one cell, a missing file', async () => {
    const out = sheetRows(await readSheet(sample('excel.xlsx')), ACCOUNTS, 50)
    expect(out.rows.map((r) => [r.when, r.caption, r.fileNames])).toEqual([
      [{ localDate: '2026-12-07', localTime: '12:30' }, 'Pane di segale', ['pane.jpg']],
      [
        { localDate: '2026-12-08', localTime: '18:00' },
        'Data e ora insieme',
        ['focaccia-1.jpg', 'focaccia-2.jpg'],
      ],
      [{ localDate: '2026-12-09', localTime: '09:15' }, 'Data come testo', ['cornetto.jpg']],
    ])
    expect(out.problems).toEqual([{ line: 5, problem: { code: 'noFile' } }])
    expect(filesAsked(out.rows)).toEqual([
      'pane.jpg',
      'focaccia-1.jpg',
      'focaccia-2.jpg',
      'cornetto.jpg',
    ])
  })

  test('Numbers (.xlsx): the first sheet by its relation, dates from 1904, texts in the cells, the rows numbered as the sheet', async () => {
    const cells = await readSheet(sample('numbers.xlsx'))
    expect(cells.date1904).toBe(true)
    const out = sheetRows(cells, ACCOUNTS, 50)
    expect(out.rows.map((r) => [r.line, r.when, r.caption, r.accountIds])).toEqual([
      [2, { localDate: '2026-12-11', localTime: '12:30' }, 'Pane & focaccia', ['ig']],
      [4, { localDate: '2026-12-12', localTime: '12:00' }, 'Riga dopo una vuota', ['fb']],
    ])
  })
})

test('a sheet without the file or the account column says which; past 50 rows the rest is counted', () => {
  expect(sheetRows({ rows: [['data', 'testo']], date1904: false }, ACCOUNTS, 50).missing).toEqual([
    'file',
    'account',
  ])
  const many = {
    rows: [
      ['file', 'account'],
      ...Array.from({ length: 3 }, (_, i) => [`${String(i)}.jpg`, '@fornoluce']),
    ],
    date1904: false,
  }
  const out = sheetRows(many, ACCOUNTS, 2)
  expect(out.rows).toHaveLength(2)
  expect(out.leftOut).toBe(1)
})

test('the template is read back as two good rows', () => {
  const out = sheetRows({ rows: parseCsv(SHEET_TEMPLATE), date1904: false }, ACCOUNTS, 50)
  expect(out.problems).toEqual([])
  expect(out.rows).toHaveLength(2)
})
