import type { Platform } from '../accounts/accounts.js'
import type { PostCaption, PostType } from './types.js'

// The counters of a caption (plan 05, Scelta 1; D-46). The editor of stage 6 shows the same
// numbers the rules check.

/** `#` after a non-word character, then letters (with their accents), digits or `_`. */
const HASHTAG = /(?<![\p{L}\p{M}\p{N}_&])#[\p{L}\p{M}\p{N}_]+/gu
/** `@` after a non-word character, then a user name: letters, digits, `.`, `_`, up to 30. */
const MENTION = /(?<![\p{L}\p{M}\p{N}_.@])@[A-Za-z0-9._]{1,30}(?![A-Za-z0-9._@])/gu

export interface CaptionStats {
  /** Unicode code points: an emoji with a skin tone counts 2 */
  characters: number
  /** every time, repeated ones too */
  hashtags: number
  mentions: number
}

export function captionStats(text: string): CaptionStats {
  return {
    characters: Array.from(text).length,
    hashtags: text.match(HASHTAG)?.length ?? 0,
    mentions: text.match(MENTION)?.length ?? 0,
  }
}

/**
 * The text a destination of that platform publishes (§9.1): none for a story. A platform's own
 * text left empty or blank is no text of its own, and the common one goes out (D-53): a post
 * never leaves without its text because a field was emptied.
 */
export function publishedCaption(
  draft: { type: PostType; caption: PostCaption },
  platform: Platform,
): string {
  if (draft.type === 'story') return ''
  const own = draft.caption[platform]
  return own === undefined || own.trim() === '' ? draft.caption.common : own
}

/** A piece of a caption as the apps colour it: plain text, a hashtag or a mention. */
export interface CaptionPart {
  kind: 'text' | 'hashtag' | 'mention'
  text: string
}

/**
 * The caption cut where the apps colour it (the editor's preview, plan 06 Task 6), read as
 * `captionStats` counts: the same hashtags and mentions.
 */
export function captionParts(text: string): CaptionPart[] {
  const marks = [
    ...[...text.matchAll(HASHTAG)].map((m) => ({ kind: 'hashtag' as const, m })),
    ...[...text.matchAll(MENTION)].map((m) => ({ kind: 'mention' as const, m })),
  ].sort((a, b) => a.m.index - b.m.index)
  const parts: CaptionPart[] = []
  let at = 0
  for (const { kind, m } of marks) {
    if (m.index < at) continue
    if (m.index > at) parts.push({ kind: 'text', text: text.slice(at, m.index) })
    parts.push({ kind, text: m[0] })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) })
  return parts
}
