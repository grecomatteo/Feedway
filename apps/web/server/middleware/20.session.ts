/**
 * The session is resolved once per request on the API, the Better Auth routes and the pages:
 * our 30-day limit and the person's state (disabled, anonymized) apply to Better Auth's own
 * endpoints too, which would otherwise accept such a session (Task 9).
 */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  const api = path.startsWith('/api/v1/') || path.startsWith('/api/auth/')
  // other API routes, Nuxt's own (/_nuxt, /__nuxt_error, /_i18n) and files need no session
  const page = !path.startsWith('/api/') && !path.startsWith('/_') && !/\.\w+$/.test(path)
  // a page may carry a renewed session cookie and personal data: no cache keeps it
  if (page) setResponseHeader(event, 'cache-control', 'private, no-store')
  if (api || page) await loadSession(event)
})
