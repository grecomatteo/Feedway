import { isPlainDisplayName } from '../identity/display-name.js'
import { PALETTES } from '../identity/profile.js'

// The content settings of a workspace (spec §11.7, plan 06 Task 3).

/** `HH:MM`, 00:00 to 23:59: the local time a new post of the workspace proposes. */
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** null clears it. */
export function validateDefaultPostTime(
  value: string | null,
): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  return LOCAL_TIME.test(value) ? { ok: true, value } : { ok: false }
}

export const LABEL_NAME_MAX_LENGTH = 40
/** The colours of the themes of DESIGN.md: each one drawn with that theme's accent. */
export const LABEL_COLORS = PALETTES
export type LabelColor = (typeof LABEL_COLORS)[number]

/** A label as stored: the name trimmed, 1 to 40 characters of plain text. */
export function validateLabel(raw: {
  name: string
  color: string
}):
  | { ok: true; value: { name: string; color: LabelColor } }
  | { ok: false; field: 'name' | 'color' } {
  const name = raw.name.trim()
  const length = Array.from(name).length
  if (length < 1 || length > LABEL_NAME_MAX_LENGTH || !isPlainDisplayName(name))
    return { ok: false, field: 'name' }
  if (!(LABEL_COLORS as readonly string[]).includes(raw.color)) return { ok: false, field: 'color' }
  return { ok: true, value: { name, color: raw.color as LabelColor } }
}

/** What a template of a workspace inserts (§11.7). */
export const CAPTION_TEMPLATE_KINDS = ['caption', 'signature', 'hashtags'] as const
export type CaptionTemplateKind = (typeof CAPTION_TEMPLATE_KINDS)[number]
