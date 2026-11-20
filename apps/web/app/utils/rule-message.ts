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

/** Rome's two offsets, when the outcome does not say its zone: «ora legale» and «ora solare». */
const ZONES: Readonly<Record<string, string>> = { '+02:00': 'summer', '+01:00': 'winter' }

/**
 * The long name of the post's zone at that instant (D-58), as Italian says it: «ora legale
 * dell’Europa centrale», «ora legale orientale USA». null: the runtime does not know it.
 */
function zoneName(timeZone: string, at: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('it-IT', {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(new Date(at))
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    return name ? name.charAt(0).toLowerCase() + name.slice(1) : null
  } catch {
    return null
  }
}

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
      const named =
        typeof params.timeZone === 'string' && typeof params.at === 'string'
          ? zoneName(params.timeZone, params.at)
          : null
      const zone = ZONES[String(value)]
      values.zone = named ?? (zone === undefined ? `UTC${String(value)}` : t(`rules.zones.${zone}`))
    } else if (name === 'timeZone' || name === 'at') continue
    else if (typeof value === 'number')
      values[name] = BYTE_PARAMS[outcome.code]?.includes(name)
        ? formatBytes(value)
        : (COUNTS.has(name) ? COUNT : PLAIN).format(value)
    else values[name] = value
  }
  return values
}

/**
 * Codes whose choices have words of their own, saying what each does to the file (screen 09,
 * B6): `rules.<code>.options.<option>` in place of the shared `rules.options.<option>`.
 */
const OWN_OPTIONS: ReadonlySet<string> = new Set(['reel_aspect_ratio'])

export function ruleMessage(outcome: RuleMessageInput, t: Translate): RuleMessage {
  const values = ruleValues(outcome, t)
  const options = OWN_OPTIONS.has(outcome.code) ? `rules.${outcome.code}.options` : 'rules.options'
  return {
    title: t(`rules.${outcome.code}.title`, values),
    text: t(`rules.${outcome.code}.text`, values),
    options: (outcome.options ?? []).map((o) => t(`${options}.${o}`, values)),
  }
}
