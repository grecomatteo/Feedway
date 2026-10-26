/** A link (scheme, `://`, `www.`): never a legitimate part of a name others read. */
const LOOKS_LIKE_LINK = /:\/\/|\bwww\.|\b(?:https?|ftp|mailto|javascript|data|file|tel|sms):/i
/** Control characters and the bidirectional overrides that would reorder the text around them. */
const HIDDEN_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u

/**
 * Whether a name shown to other people (nickname, agency, workspace) is plain text: it ends up
 * in emails and in the panel, so a link or hidden characters there could only mislead.
 */
export function isPlainDisplayName(value: string): boolean {
  return !LOOKS_LIKE_LINK.test(value) && !HIDDEN_CHARACTERS.test(value)
}
