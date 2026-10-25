/**
 * API answers hold personal data and are never pages: no cache (shared or private), no framing,
 * nothing to run. Set first, so error answers carry them too.
 */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; frame-ancestors 'none'")
})
