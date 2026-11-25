import { readZipEntry, readZipIndex, type ZipEntry } from './zip-index.ts'

// A sheet prepared elsewhere becomes rows of «In blocco» (spec §11.6 point 2, plan 09 Task 11,
// P6, Scelta 8): a CSV (Excel in Italian writes `;`, Google Sheets `,`; quotes, a BOM) or an
// `.xlsx` (Excel, Numbers), read here in the browser with no library. The first sheet is the one
// the workbook lists first, found through its relations, not by name; texts come from the shared
// strings or written in the cell; dates may be Excel's serial numbers, from 1900 or from 1904
// (Numbers and the old Excel for Mac). The columns are named in Italian or in English; files are
// matched by name, accounts by username or by the Page's name. Every problem is said with its row.

// ---- the cells of a sheet, as text

/** The rows of the sheet, as text, the first one the names of the columns. */
export interface SheetCells {
  rows: string[][]
  /** the number of each row in the sheet, as the program shows it: empty rows are left out */
  lines?: number[]
  /** serial dates count from 1904 (Numbers, Excel for Mac) */
  date1904: boolean
}

/** CSV: `;` or `,` (the one found more often outside quotes in the first line), quotes, a BOM. */
export function parseCsv(text: string): string[][] {
  return csvCells(text).rows
}

/** The CSV as the cells of a sheet, with the number of each record as the sheet shows it. */
export function csvCells(text: string): SheetCells {
  const all = records(text)
  const rows: string[][] = []
  const lines: number[] = []
  all.forEach((r, i) => {
    if (!r.some((c) => c.trim() !== '')) return
    rows.push(r)
    lines.push(i + 1)
  })
  return { rows, lines, date1904: false }
}

function records(text: string): string[][] {
  const body = text.startsWith('﻿') ? text.slice(1) : text
  const delimiter = guessDelimiter(body)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charAt(i)
    if (quoted) {
      if (ch === '"') {
        if (body.charAt(i + 1) === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body.charAt(i + 1) === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function guessDelimiter(text: string): ';' | ',' {
  let semicolons = 0
  let commas = 0
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '\n' || ch === '\r')) break
    else if (!quoted && ch === ';') semicolons += 1
    else if (!quoted && ch === ',') commas += 1
  }
  return semicolons >= commas && semicolons > 0 ? ';' : ','
}

// ---- a small XML reader: the parts of an .xlsx are plain elements, no DTD, no entities of their
// own. Only the five named entities and the numeric ones are read; anything else stays as written.

export interface XmlNode {
  /** the name without its prefix: `sheet`, `c`, `t` */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
function decode(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
    return ENTITY[name] ?? whole
  })
}
const localName = (name: string) => name.slice(name.indexOf(':') + 1)

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const token =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(?:[^>])*>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g
  for (const m of xml.matchAll(token)) {
    const top = stack.at(-1) ?? root
    const [, cdata, closing, tag, attrText, selfClosing, text] = m
    if (cdata !== undefined) top.text += cdata
    else if (text !== undefined) top.text += decode(text)
    else if (tag !== undefined) {
      if (closing) {
        if (stack.length > 1) stack.pop()
        continue
      }
      const node: XmlNode = { name: localName(tag), attrs: {}, children: [], text: '' }
      for (const a of (attrText ?? '').matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
        if (a[1]) node.attrs[a[1]] = decode(a[3] ?? a[4] ?? '')
      top.children.push(node)
      if (!selfClosing) stack.push(node)
    }
  }
  return root
}

/** Every node named `name` under `node`, in document order. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}
const first = (node: XmlNode, name: string) => findAll(node, name)[0] ?? null
/** The text of a node and of every node inside it (a rich text is runs of `<r><t>`). */
const textOf = (node: XmlNode): string =>
  node.name === 't' ? node.text : node.children.map(textOf).join('')
const attr = (node: XmlNode, name: string) =>
  node.attrs[name] ?? Object.entries(node.attrs).find(([k]) => localName(k) === name)?.[1]

// ---- .xlsx

export type SheetProblem = 'not_sheet' | 'too_big' | 'empty'
export class SheetError extends Error {
  constructor(readonly problem: SheetProblem) {
    super(`sheet: ${problem}`)
  }
}

/** A part of the workbook is read up to this size: a sheet of 50 rows is far smaller. */
const PART_LIMIT = 8 * 1024 * 1024

/** The column of a cell from its reference: `C7` → 2. */
export function columnOf(ref: string): number {
  let n = 0
  for (const ch of ref.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') break
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

/** Joins a target of the relations to the folder of the part that has them. */
function resolve(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.' && piece !== '') parts.push(piece)
  }
  return parts.join('/')
}

/** The first sheet of an .xlsx, as text, with how its dates count. */
export async function readXlsx(file: Blob): Promise<SheetCells> {
  let entries: ZipEntry[]
  try {
    entries = await readZipIndex(file)
  } catch {
    throw new SheetError('not_sheet')
  }
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e]))
  async function part(name: string): Promise<XmlNode | null> {
    const entry = byName.get(name)
    if (!entry) return null
    let blob: File
    try {
      blob = await readZipEntry(file, entry, { name, type: 'application/xml', limit: PART_LIMIT })
    } catch {
      throw new SheetError('too_big')
    }
    return parseXml(await blob.text())
  }
  const workbook = await part('xl/workbook.xml')
  if (!workbook) throw new SheetError('not_sheet')
  const pr = first(workbook, 'workbookPr')
  const date1904 = ['1', 'true'].includes(pr ? (attr(pr, 'date1904') ?? '') : '')
  const sheet = first(workbook, 'sheet')
  const relId = sheet ? attr(sheet, 'id') : undefined
  const rels = await part('xl/_rels/workbook.xml.rels')
  const rel = rels && findAll(rels, 'Relationship').find((r) => r.attrs['Id'] === relId)
  const target = rel?.attrs['Target']
  if (!target) throw new SheetError('not_sheet')
  const sheetXml = await part(resolve('xl/workbook.xml', target))
  if (!sheetXml) throw new SheetError('not_sheet')
  const sharedXml = await part('xl/sharedStrings.xml')
  const shared = sharedXml ? findAll(sharedXml, 'si').map(textOf) : []

  const rows: string[][] = []
  const lines: number[] = []
  for (const row of findAll(sheetXml, 'row')) {
    const cells: string[] = []
    let next = 0
    for (const c of row.children.filter((n) => n.name === 'c')) {
      const ref = attr(c, 'r')
      const col = ref ? columnOf(ref) : next
      next = col + 1
      const type = attr(c, 't') ?? 'n'
      const v = first(c, 'v')?.text ?? ''
      let value: string
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr')
        value = c.children
          .filter((n) => n.name === 'is')
          .map(textOf)
          .join('')
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else value = v
      while (cells.length < col) cells.push('')
      cells[col] = value
    }
    if (cells.some((x) => x.trim() !== '')) {
      rows.push(cells)
      lines.push(Number(attr(row, 'r') ?? rows.length))
    }
  }
  return { rows, lines, date1904 }
}

/** A file chosen as a sheet: .xlsx by its name or its first bytes (`PK`), otherwise CSV. */
export async function readSheet(file: File): Promise<SheetCells> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (/\.xlsx$/i.test(file.name) || (head[0] === 0x50 && head[1] === 0x4b)) return readXlsx(file)
  if (file.size > PART_LIMIT) throw new SheetError('too_big')
  return csvCells(await file.text())
}

// ---- the columns

export type SheetColumn =
  'date' | 'time' | 'caption' | 'account' | 'file' | 'captionInstagram' | 'captionFacebook'

const NAMES: Record<string, SheetColumn> = {
  data: 'date',
  giorno: 'date',
  date: 'date',
  day: 'date',
  ora: 'time',
  orario: 'time',
  time: 'time',
  testo: 'caption',
  didascalia: 'caption',
  caption: 'caption',
  text: 'caption',
  account: 'account',
  accounts: 'account',
  file: 'file',
  files: 'file',
  testo_instagram: 'captionInstagram',
  caption_instagram: 'captionInstagram',
  testo_facebook: 'captionFacebook',
  caption_facebook: 'captionFacebook',
}
const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

/** Which column is which, from the names in the first row; unknown names are left out. */
export function columnsOf(header: readonly string[]): Partial<Record<SheetColumn, number>> {
  const out: Partial<Record<SheetColumn, number>> = {}
  header.forEach((name, index) => {
    const column = NAMES[normal(name)]
    if (column && out[column] === undefined) out[column] = index
  })
  return out
}

// ---- days and times

const pad = (n: number) => String(n).padStart(2, '0')
function validDate(y: number, m: number, d: number) {
  const at = new Date(Date.UTC(y, m - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
}

/** `GG/MM/AAAA`, `AAAA-MM-GG` or a serial number of Excel → `AAAA-MM-GG`; null if not a day. */
export function parseSheetDate(value: string, date1904: boolean): string | null {
  const s = value.trim()
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validDate(y, mo, d) ? `${String(y)}-${pad(mo)}-${pad(d)}` : null
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validDate(y, mo, d) ? `${String(y)}-${pad(mo)}-${pad(d)}` : null
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    // 1900: day 1 is 1900-01-01 and Excel counts a 29 February 1900 that never was, so from
    // day 61 the days are one less; 1904: day 0 is 1904-01-01
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial > 60 ? 30 : 31)
    if (serial < (date1904 ? 0 : 1) || serial > 2_958_465) return null
    const at = new Date(base + serial * 86_400_000)
    return `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
  }
  return null
}

/** `HH:MM` (seconds left out) or a fraction of a day of Excel → `HH:MM`; null if not. */
export function parseSheetTime(value: string): string | null {
  const s = value.trim()
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (m) {
    const [h, min] = [Number(m[1]), Number(m[2])]
    return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null
  }
  if (/^0?\.\d+$|^0$/.test(s)) {
    const minutes = Math.round(Number(s) * 24 * 60)
    if (minutes >= 24 * 60) return null
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
  }
  // a whole date and time of Excel in one cell: its fraction is the time
  if (/^\d{3,}\.\d+$/.test(s)) return parseSheetTime(`0.${s.split('.')[1] ?? '0'}`)
  return null
}

// ---- the rows

export interface SheetAccount {
  id: string
  platform: string
  username: string | null
  name: string
}

export interface SheetRow {
  /** the row of the sheet, counted as the sheet counts it (the names are row 1) */
  line: number
  when: { localDate: string; localTime: string } | null
  caption: string
  captionInstagram: string | null
  captionFacebook: string | null
  accountIds: string[]
  fileNames: string[]
}

export type SheetRowProblem =
  | { code: 'date'; value: string }
  | { code: 'time'; value: string }
  | { code: 'account'; value: string }
  | { code: 'noFile' }
  | { code: 'tooManyFiles'; value: string }

export interface SheetImport {
  rows: SheetRow[]
  /** problems by row; a row with one is not taken */
  problems: { line: number; problem: SheetRowProblem }[]
  /** the columns the sheet lacks among the ones needed */
  missing: SheetColumn[]
  /** rows past the 50 of a table */
  leftOut: number
}

const MAX_FILES = 10
const splitList = (s: string) =>
  s
    .split(/[|\n]/)
    .map((x) => x.trim())
    .filter((x) => x !== '')

/** The account a cell names: `@username`, the username, or the Page's (or profile's) name. */
function accountOf(value: string, accounts: readonly SheetAccount[]): SheetAccount | null {
  const s = value.trim().replace(/^@/, '').toLowerCase()
  const named = accounts.filter((a) => a.name.trim().toLowerCase() === s)
  // a username is an Instagram's; a name is first the Page's, which has no username
  return (
    accounts.find((a) => (a.username ?? '').toLowerCase() === s) ??
    named.find((a) => a.platform === 'facebook') ??
    named[0] ??
    null
  )
}

/**
 * The sheet as rows of the table: each row checked on its own, the good ones kept in order. The
 * files are only named here: the page matches them to the files chosen.
 */
export function sheetRows(
  cells: SheetCells,
  accounts: readonly SheetAccount[],
  maxRows: number,
): SheetImport {
  const [header, ...body] = cells.rows
  if (!header) throw new SheetError('empty')
  const col = columnsOf(header)
  const missing = (['file', 'account'] as const).filter((c) => col[c] === undefined)
  if (missing.length > 0) return { rows: [], problems: [], missing, leftOut: 0 }
  const cell = (row: string[], c: SheetColumn) => {
    const index = col[c]
    return index === undefined ? '' : (row[index] ?? '').trim()
  }
  const rows: SheetRow[] = []
  const problems: SheetImport['problems'] = []
  let leftOut = 0
  body.forEach((row, i) => {
    const line = cells.lines?.[i + 1] ?? i + 2
    const before = problems.length
    const say = (problem: SheetRowProblem) => problems.push({ line, problem })
    const dateText = cell(row, 'date')
    const timeText = cell(row, 'time')
    const localDate = dateText ? parseSheetDate(dateText, cells.date1904) : null
    if (dateText && !localDate) say({ code: 'date', value: dateText })
    // a time in the cell of the date (an Excel date and time) is taken when the time is empty
    const localTime = timeText
      ? parseSheetTime(timeText)
      : /^\d+\.\d+$/.test(dateText)
        ? parseSheetTime(dateText)
        : null
    if (timeText && !localTime) say({ code: 'time', value: timeText })
    const accountIds: string[] = []
    for (const name of splitList(cell(row, 'account'))) {
      const account = accountOf(name, accounts)
      if (account) {
        if (!accountIds.includes(account.id)) accountIds.push(account.id)
      } else say({ code: 'account', value: name })
    }
    const fileNames = splitList(cell(row, 'file'))
    if (fileNames.length === 0) say({ code: 'noFile' })
    else if (fileNames.length > MAX_FILES)
      say({ code: 'tooManyFiles', value: String(fileNames.length) })
    if (problems.length > before) return
    if (rows.length >= maxRows) {
      leftOut += 1
      return
    }
    rows.push({
      line,
      when: localDate ? { localDate, localTime: localTime ?? '12:00' } : null,
      caption: cell(row, 'caption'),
      captionInstagram: cell(row, 'captionInstagram') || null,
      captionFacebook: cell(row, 'captionFacebook') || null,
      accountIds,
      fileNames,
    })
  })
  return { rows, problems, missing: [], leftOut }
}

/** The names of the files a set of rows asks for, once each, in order. */
export const filesAsked = (rows: readonly SheetRow[]) => [
  ...new Set(rows.flatMap((r) => r.fileNames)),
]

/** The template to download: the names of the columns and two rows to copy. */
export const SHEET_TEMPLATE = [
  'data;ora;testo;account;file;testo_instagram;testo_facebook',
  '02/12/2026;12:30;"Il pane di segale è tornato";@fornoluce;pane.jpg;;',
  '03/12/2026;18:00;"Tre focacce, una per giorno";@fornoluce|Forno Luce;focaccia-1.jpg|focaccia-2.jpg;"#focaccia";',
].join('\r\n')
