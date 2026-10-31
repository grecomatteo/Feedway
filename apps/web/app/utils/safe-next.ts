/**
 * A path inside the panel, never another site. Browsers drop tabs and line breaks and read `\`
 * as `/`, so anything with those is refused before the origin check.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2000) return null
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null
  try {
    const base = 'https://panel.invalid'
    const url = new URL(value, base)
    if (url.origin !== base || url.pathname.startsWith('/api/')) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}
