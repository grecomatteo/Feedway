const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Requests that change something must come from the panel itself (spec §15.3): same origin,
 * the `X-App-Request: 1` header, which a cross-site form cannot send, and, when the browser
 * sends fetch metadata, `Sec-Fetch-Site: same-origin` (a sibling subdomain is `same-site`).
 */
export default defineEventHandler((event) => {
  const path = event.path
  if (!path.startsWith('/api/auth/') && !path.startsWith('/api/v1/')) return
  if (SAFE_METHODS.has(event.method)) return
  const origin = getRequestHeader(event, 'origin')
  const site = getRequestHeader(event, 'sec-fetch-site')
  if (
    origin === useDeps().config.panelUrl.origin &&
    getRequestHeader(event, 'x-app-request') === '1' &&
    (site === undefined || site === 'same-origin')
  )
    return
  return sendApiError(event, new HttpProblem('FORBIDDEN', { message: CSRF_MESSAGE }))
})
