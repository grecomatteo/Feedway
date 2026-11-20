import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { RULE_CODES, RULE_OPTIONS } from '@app/domain'
import { FACEBOOK_FORMATS, INSTAGRAM_FORMATS } from '@app/domain/platforms/meta'
import { RULE_CASES } from '@app/domain/testing'
import { ruleMessage } from '../app/utils/rule-message.ts'
import { CODES_WITHOUT_CASE, buildRulesTable, message, translate } from './rules-table.ts'

// The table Matteo reads, and the completeness of the texts (plan 05 Task 2, «Codici, non
// testi»). With RULES_TABLE_WRITE=1 (`pnpm rules:table`) the document is written again.

const DOCUMENT = new URL('../../../docs/regole/casi-dei-controlli.md', import.meta.url)

test('docs/regole/casi-dei-controlli.md is made from the cases', () => {
  const table = buildRulesTable()
  if (process.env.RULES_TABLE_WRITE === '1') writeFileSync(DOCUMENT, table)
  let written = ''
  try {
    written = readFileSync(DOCUMENT, 'utf8')
  } catch {
    // no document yet: the comparison below says how to make it
  }
  expect(written, 'the table is out of date: run `pnpm rules:table`').toBe(table)
})

test('every code of the rules has a case, or says why it has none', () => {
  const inCases = new Set(RULE_CASES.flatMap((c) => c.expected.map((e) => e.code)))
  const missing = RULE_CODES.filter((code) => !inCases.has(code) && !(code in CODES_WITHOUT_CASE))
  expect(missing).toEqual([])
  for (const code of Object.keys(CODES_WITHOUT_CASE)) expect(inCases.has(code), code).toBe(false)
})

test('every option that changes the post or answers a warning is chosen in some case', () => {
  const chosen = new Set(RULE_CASES.flatMap((c) => c.expected.flatMap((e) => e.chosen ?? [])))
  const changing = ['photos_only', 'first_files', 'publish_as_video', 'skip_platform']
  expect(changing.filter((o) => !chosen.has(o as (typeof RULE_OPTIONS)[number]))).toEqual([])
})

// the parts of `rules` that are not a code
const SHARED = new Set(['levels', 'platforms', 'types', 'zones', 'formats', 'reasons', 'options'])

test('every code has its title and text, and every text its code', () => {
  for (const code of RULE_CODES) {
    expect(message(`rules.${code}.title`), code).toEqual(expect.any(String))
    expect(message(`rules.${code}.text`), code).toEqual(expect.any(String))
  }
  const rules = message('rules') as Record<string, unknown>
  const codes = new Set<string>(RULE_CODES)
  expect(Object.keys(rules).filter((k) => !SHARED.has(k) && !codes.has(k))).toEqual([])
})

test('every option, format, level and reason has its words', () => {
  const words = (prefix: string, keys: readonly string[]) => {
    for (const key of keys)
      expect(message(`${prefix}.${key}`), `${prefix}.${key}`).toEqual(expect.any(String))
    expect(Object.keys(message(prefix) as object).sort()).toEqual([...keys].sort())
  }
  words('rules.options', RULE_OPTIONS)
  words('rules.formats.instagram', INSTAGRAM_FORMATS)
  words('rules.formats.facebook', FACEBOOK_FORMATS)
  words('rules.levels', ['block', 'warning', 'fix'])
  words('rules.types', ['photo', 'carousel', 'reel', 'story'])
  words('rules.reasons.account_unhealthy', ['inactive', 'unchecked', 'error'])
})

test('the texts use no character vue-i18n would read as its own syntax', () => {
  const texts: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') texts.push(node)
    else if (typeof node === 'object' && node !== null) Object.values(node).forEach(walk)
  }
  walk(message('rules'))
  // `@` starts a linked message and `|` splits plural forms
  expect(texts.filter((t) => /[@|$%]/.test(t))).toEqual([])
})

// screen 09 (review of fidelity, B6): each choice says what happens to the video
test("a reel's video that is not 9:16 names its choices by what they do", () => {
  const m = ruleMessage(
    {
      code: 'reel_aspect_ratio',
      params: { width: 1920, height: 1080 },
      options: ['keep', 'pad', 'crop_center'],
    },
    translate,
  )
  expect(m.title).toBe('Il video non ha la forma di un reel')
  expect(m.options).toEqual([
    "Così com'è, senza modifiche",
    'Intero, con le bande sopra e sotto',
    'Ritagliato al centro, a tutto schermo',
  ])
})
