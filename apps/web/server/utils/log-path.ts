// An unused activation link creates an account: its token must not end up in the logs.
const TOKEN_IN_PATH = /^(\/api\/v1\/links|\/attiva)\/[^/]+/

/** The request path as the log records it: no query, no link token. */
export function loggablePath(path: string): string {
  return (path.split('?')[0] ?? '').replace(TOKEN_IN_PATH, '$1/:token')
}
