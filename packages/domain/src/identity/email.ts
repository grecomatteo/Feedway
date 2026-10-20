export const EMAIL_MAX_LENGTH = 254

// Deliberately loose: the address is proven by the link that reaches it, not by this pattern.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Trimmed and lowercased, or null when it is not an address. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.length <= EMAIL_MAX_LENGTH && SHAPE.test(email) ? email : null
}
