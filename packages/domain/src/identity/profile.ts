export const NICKNAME_MAX_GRAPHEMES = 30
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_MAX_PIXELS = 40_000_000
export const AVATAR_SIZES = [256, 64] as const
export const AVATAR_MIN_CROP = 64
export type AvatarSourceType = 'jpeg' | 'png' | 'heic' | 'webp'

const graphemes = (text: string): string[] =>
  Array.from(new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(text), (s) => s.segment)

/** A link (scheme, `://`, `www.`): a nickname shows up in emails to other people. */
const LOOKS_LIKE_LINK = /:\/\/|\bwww\.|\b(?:https?|ftp|mailto|javascript|data|file|tel|sms):/i
/** Control characters and the bidirectional overrides that would reorder the text around them. */
const HIDDEN_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u

export function validateNickname(
  raw: string | null,
): { ok: true; value: string | null } | { ok: false; reason: 'TOO_LONG' | 'INVALID' } {
  const value = raw?.trim() ?? ''
  if (value === '') return { ok: true, value: null }
  if (graphemes(value).length > NICKNAME_MAX_GRAPHEMES) return { ok: false, reason: 'TOO_LONG' }
  if (LOOKS_LIKE_LINK.test(value) || HIDDEN_CHARACTERS.test(value))
    return { ok: false, reason: 'INVALID' }
  return { ok: true, value }
}

/** The 256 px photo, with its content hash so a new photo is never served from a cache. */
export function avatarUrl(userId: string, avatarKey: string | null): string | null {
  if (avatarKey === null) return null
  const hash = avatarKey.split('/').at(-1) ?? ''
  return `/api/v1/users/${encodeURIComponent(userId)}/avatar/256?v=${encodeURIComponent(hash)}`
}

export function displayName(user: { name: string; nickname: string | null }): string {
  return user.nickname ?? user.name
}

/** Two letters for a missing photo: first and last word, or the first two letters of a single word. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '')
  const first = words[0]
  if (first === undefined) return '?'
  const last = words.length > 1 ? words[words.length - 1] : undefined
  const letters =
    last === undefined ? graphemes(first).slice(0, 2) : [graphemes(first)[0], graphemes(last)[0]]
  return letters.join('').toLocaleUpperCase('it')
}

export function validateCrop(
  crop: { x: number; y: number; size: number },
  image: { width: number; height: number },
): boolean {
  const { x, y, size } = crop
  if (![x, y, size].every(Number.isInteger)) return false
  return (
    size >= AVATAR_MIN_CROP &&
    x >= 0 &&
    y >= 0 &&
    x + size <= image.width &&
    y + size <= image.height
  )
}
