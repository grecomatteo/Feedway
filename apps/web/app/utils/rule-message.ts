import { formatBytes } from './format-bytes.ts'

// The text of an outcome of the checks (plan 05, «Codici, non testi»): `rules.<code>` of
// it.json with the outcome's parameters made readable. The editor of stage 6 shows these, and
// `docs/regole/casi-dei-controlli.md` is written with the same function.

export interface RuleMessageInput {
  code: string
  params: Readonly<Record<string, string | number>>
  platform?: string
  options?: readonly string[]
}

export type Translate = (key: string, values?: Record<string, string>) => string

export interface RuleMessage {
  title: string
  text: string
  /** the labels of the options, in their order */
  options: string[]
}

/** Parameters that are a size in bytes, by code: the rest are counts, seconds or pixels. */
const BYTE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  file_recompress: ['limit'],
  story_recompressed: ['limit'],
  cover_converted: ['limit'],
}

/** Rome's two offsets (the posts' time zone): «ora legale» and «ora solare». */
const ZONES: Readonly<Record<string, string>> = { '+02:00': 'summer', '+01:00': 'winter' }

/** Counts with their thousands (2.200 caratteri); sizes in pixels and frames without (1080×1920). */
const COUNT = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: 'always' })
const PLAIN = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: false })
const COUNTS = new Set(['limit', 'found', 'total', 'left', 'photos'])

export function ruleValues(outcome: RuleMessageInput, t: Translate): Record<string, string> {
  const values: Record<string, string> = {}
  const params: Record<string, string | number> = {
    ...(outcome.platform === undefined ? {} : { platform: outcome.platform }),
    ...outcome.params,
  }
  for (const [name, value] of Object.entries(params)) {
    if (name === 'platform') values[name] = t(`rules.platforms.${String(value)}`)
    else if (name === 'type') values[name] = t(`rules.types.${String(value)}`)
    else if (name === 'reason')
      values[name] =
        outcome.code === 'media_failed'
          ? t(`library.failure.${String(value)}`)
          : t(`rules.reasons.${outcome.code}.${String(value)}`)
    else if (name === 'offset') {
      const zone = ZONES[String(value)]
      values.zone = zone === undefined ? `UTC${String(value)}` : t(`rules.zones.${zone}`)
    } else if (typeof value === 'number')
      values[name] = BYTE_PARAMS[outcome.code]?.includes(name)
        ? formatBytes(value)
        : (COUNTS.has(name) ? COUNT : PLAIN).format(value)
    else values[name] = value
  }
  return values
}

export function ruleMessage(outcome: RuleMessageInput, t: Translate): RuleMessage {
  const values = ruleValues(outcome, t)
  return {
    title: t(`rules.${outcome.code}.title`, values),
    text: t(`rules.${outcome.code}.text`, values),
    options: (outcome.options ?? []).map((o) => t(`rules.options.${o}`, values)),
  }
}
