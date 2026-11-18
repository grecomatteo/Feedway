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

export const CAPTION_TEMPLATE_NAME_MAX_LENGTH = 80
/** The longest caption of Instagram: a longer template could never be used whole. */
export const CAPTION_TEMPLATE_BODY_MAX_LENGTH = 2200

const length = (value: string) => Array.from(value).length

/** A template as stored: the name trimmed and plain, the text as written but not blank. */
export function validateCaptionTemplate(raw: {
  kind: string
  name: string
  body: string
}):
  | { ok: true; value: { kind: CaptionTemplateKind; name: string; body: string } }
  | { ok: false; field: 'kind' | 'name' | 'body' } {
  if (!(CAPTION_TEMPLATE_KINDS as readonly string[]).includes(raw.kind))
    return { ok: false, field: 'kind' }
  const name = raw.name.trim()
  if (
    length(name) < 1 ||
    length(name) > CAPTION_TEMPLATE_NAME_MAX_LENGTH ||
    !isPlainDisplayName(name)
  )
    return { ok: false, field: 'name' }
  if (raw.body.trim() === '' || length(raw.body) > CAPTION_TEMPLATE_BODY_MAX_LENGTH)
    return { ok: false, field: 'body' }
  return { ok: true, value: { kind: raw.kind as CaptionTemplateKind, name, body: raw.body } }
}

export const ACCOUNT_GROUP_NAME_MAX_LENGTH = 80
/** As many accounts as a post can have destinations. */
export const ACCOUNT_GROUP_MAX_ACCOUNTS = 100

/** A group's name trimmed, or null when it is not 1 to 80 characters of plain text. */
export function validateGroupName(raw: string): string | null {
  const name = raw.trim()
  return length(name) >= 1 &&
    length(name) <= ACCOUNT_GROUP_NAME_MAX_LENGTH &&
    isPlainDisplayName(name)
    ? name
    : null
}

export const NOTE_MAX_LENGTH = 2000

/** An internal note trimmed, or null when it is empty or longer than 2000 characters. */
export function validateNoteBody(raw: string): string | null {
  const body = raw.trim()
  return length(body) >= 1 && length(body) <= NOTE_MAX_LENGTH ? body : null
}
