const PUBLIC_PREFIX = /^\/+(m|share)(\/|$)/i
// as long as a public token (32 characters) or longer: never in a log line
const TOKEN_LIKE = /[A-Za-z0-9_-]{32,}/g

/**
 * The path of a request as the log writes it: whoever reads the log must not be able to fetch a
 * public file (plan 04 Task 11). `/m/*` and `/share/*` lose everything after their prefix,
 * however they are written; anything as long as a token is cut out of any other path.
 */
export function pathForLog(rawUrl: string): string {
  let path = rawUrl.split('?')[0] ?? '/'
  // the absolute form (`GET http://host/m/…`) is read for its path; `//m/…` stays a path
  if (!path.startsWith('/') && URL.canParse(rawUrl)) path = new URL(rawUrl).pathname
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // kept as sent
  }
  const prefix = PUBLIC_PREFIX.exec(decoded)
  if (prefix) return `/${(prefix[1] ?? 'm').toLowerCase()}/…`
  return path.slice(0, 200).replace(TOKEN_LIKE, '…')
}
