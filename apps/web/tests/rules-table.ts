import { readFileSync } from 'node:fs'
import { evaluatePost, type RuleOutcome } from '@app/domain'
import { CONTENT_TYPES, META_LIMITS, type MetaLimit } from '@app/domain/platforms/meta'
import { RULE_CASES, type CaseSection, type RuleCase } from '@app/domain/testing'
import { formatBytes } from '../app/utils/format-bytes.ts'
import { ruleMessage, type Translate } from '../app/utils/rule-message.ts'

// `docs/regole/casi-dei-controlli.md` (plan 05 Task 2): made from the cases the tests run
// (`RULE_CASES`), the real outcomes of `evaluatePost` and the texts of it.json, so what Matteo
// reads is what the panel will say. `pnpm rules:table` writes it again.

export const MESSAGES = JSON.parse(
  readFileSync(new URL('../i18n/locales/it.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

export function message(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      MESSAGES,
    )
}

/** As vue-i18n with named values; a missing text or value is an error, never a blank. */
export const translate: Translate = (key, values = {}) => {
  const text = message(key)
  if (typeof text !== 'string') throw new Error(`no text ${key} in it.json`)
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`${key}: no value for {${name}}`)
    return value
  })
}

/** Codes no case of Instagram and Facebook can give: their text is shown with sample values. */
export const CODES_WITHOUT_CASE: Readonly<
  Record<string, { why: string; outcome: Pick<RuleOutcome, 'code' | 'params' | 'platform'> }>
> = {
  type_not_supported: {
    why: 'Instagram e Facebook hanno tutti e quattro i tipi di post: capita solo con una piattaforma futura che non ne ha uno (provato in `evaluate-post.test.ts` con regole finte).',
    outcome: {
      code: 'type_not_supported',
      params: { platform: 'facebook', type: 'story' },
      platform: 'facebook',
    },
  },
}

const SECTIONS: Record<CaseSection, string> = {
  file: 'File',
  proportions: 'Proporzioni e durata',
  post: 'Post',
}

const NUMBER = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2, useGrouping: 'always' })

function limitValue(l: MetaLimit): string {
  switch (l.unit) {
    case 'bytes':
      return formatBytes(l.value)
    case 'ms':
      return l.value > 60_000 && l.value % 60_000 === 0
        ? `${NUMBER.format(l.value / 60_000)} min`
        : `${NUMBER.format(l.value / 1000)} s`
    case 'bit/s':
      return `${NUMBER.format(l.value / 1_000_000)} Mbit/s`
    case 'characters':
      return `${NUMBER.format(l.value)} caratteri`
    case 'px':
      return `${NUMBER.format(l.value)} px`
    case 'fps':
      return `${NUMBER.format(l.value)} fps`
    case 'count':
    case 'ratio':
      return NUMBER.format(l.value)
  }
}

/** Nothing in a cell may end it: pipes and line breaks. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')

function outcomeLine(o: Pick<RuleOutcome, 'code' | 'params' | 'platform' | 'level'>) {
  const m = ruleMessage(o, translate)
  const where = o.platform ? ` · ${translate(`rules.platforms.${o.platform}`)}` : ''
  return `**${translate(`rules.levels.${o.level}`)}**${where}: **${m.title}**. ${m.text}`
}

function choicesOf(o: RuleOutcome): string {
  const labels = ruleMessage(o, translate).options
  return (o.options ?? [])
    .map((option, i) => {
      const label = labels[i] ?? option
      const marks = [
        ...(option === o.recommended ? ['consigliata'] : []),
        ...(option === o.chosen ? ['scelta nel caso'] : []),
      ]
      return marks.length > 0 ? `${label} (${marks.join(', ')})` : label
    })
    .join(' · ')
}

function goesOut(c: RuleCase, outcomes: ReturnType<typeof evaluatePost>): string {
  if (!c.destinations) return ''
  const parts = outcomes.destinations.map((d) => {
    const platform = d.platform ? translate(`rules.platforms.${d.platform}`) : d.accountId
    const format =
      d.platform && d.format ? translate(`rules.formats.${d.platform}.${d.format}`) : '—'
    const files = d.media.map((i) => String(i + 1)).join(', ')
    return `${platform}: ${format}${files ? `, file ${files}` : ''}`
  })
  return `<br>Esce: ${parts.length > 0 ? parts.join('; ') : 'nessuna destinazione'}.`
}

function caseRow(c: RuleCase): string {
  const report = evaluatePost(c.draft, c.context)
  const outcomes = report.outcomes
  const results =
    outcomes.length === 0
      ? 'Nessun esito: si può programmare.'
      : outcomes.map(outcomeLine).join('<br>')
  const choices = outcomes
    .filter((o) => o.options)
    .map(choicesOf)
    .join('<br>')
  return `| ${cell(c.scenario + goesOut(c, report))} | ${cell(results)} | ${cell(choices || '—')} |`
}

export function buildRulesTable(): string {
  const lines: string[] = [
    '# Casi dei controlli prima di programmare',
    '',
    '> Documento generato da `pnpm rules:table` (tappa 5, Task 2): non modificarlo a mano. Ogni riga è un caso dei test (`packages/domain/src/rules/cases.ts`), con gli esiti veri del motore e i messaggi esatti che il pannello mostrerà (`apps/web/i18n/locales/it.json`, sezione `rules`). Se cambia un caso, un limite o un testo, `apps/web/tests/rules-table.test.ts` fallisce finché il documento non si rigenera.',
    '',
    'Livelli: **Blocco** (il post non si può programmare finché non si sistema), **Avviso** (serve una scelta), **Correzione** (Feedway la fa da solo e la dice).',
    '',
    '## Limiti di Meta',
    '',
    'Letti sulla documentazione pubblica di Meta; nessuno è ancora provato su un account vero (tappa 7).',
    '',
    '| Limite | Valore | Fonte | Controllato il | Verificato su Meta |',
    '|---|---|---|---|---|',
  ]
  for (const l of Object.values<MetaLimit>(META_LIMITS))
    lines.push(
      `| ${cell(l.label)} | ${cell(limitValue(l))} | ${cell(l.note ? `${l.source}. ${l.note}` : l.source)} | ${l.checkedOn} | ${l.verifiedOnMeta ? 'verificato' : 'non verificato'} |`,
    )
  lines.push(
    '',
    '## Cosa diventa ogni tipo di post',
    '',
    '| Tipo | File | Instagram | Facebook | Avviso |',
    '|---|---|---|---|---|',
  )
  for (const row of CONTENT_TYPES) {
    const files =
      'media' in row
        ? { photos: 'solo foto', mixed: 'foto e video', photo: 'foto', video: 'video' }[row.media]
        : 'duration' in row
          ? row.duration
          : '—'
    // the warnings of §9.1 are all Facebook's
    const warning =
      'warning' in row
        ? translate(`rules.${row.warning}.title`, {
            platform: translate('rules.platforms.facebook'),
          })
        : '—'
    lines.push(
      `| ${translate(`rules.types.${row.type}`)} | ${files} | ${translate(`rules.formats.instagram.${row.instagram}`)} | ${translate(`rules.formats.facebook.${row.facebook}`)} | ${warning} |`,
    )
  }
  for (const [section, title] of Object.entries(SECTIONS) as [CaseSection, string][]) {
    lines.push('', `## ${title}`, '', '| Caso | Esiti e messaggi | Scelte |', '|---|---|---|')
    for (const c of RULE_CASES.filter((x) => x.section === section)) lines.push(caseRow(c))
  }
  lines.push(
    '',
    '## Esiti senza un caso',
    '',
    'Con Instagram e Facebook non capitano; il testo è pronto per quando servirà.',
    '',
    '| Esito | Perché non c’è un caso | Messaggio (con valori d’esempio) |',
    '|---|---|---|',
  )
  for (const [code, { why, outcome }] of Object.entries(CODES_WITHOUT_CASE))
    lines.push(
      `| \`${code}\` | ${cell(why)} | ${cell(outcomeLine({ ...outcome, level: 'block' }))} |`,
    )
  return `${lines.join('\n')}\n`
}
