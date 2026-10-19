const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Requests that change something must come from the panel itself: same origin and the
 * `X-App-Request: 1` header, which a cross-site form cannot send.
 */
export default defineEventHandler((event) => {
  const path = event.path
  if (!path.startsWith('/api/auth/') && !path.startsWith('/api/v1/')) return
  if (SAFE_METHODS.has(event.method)) return
  const origin = getRequestHeader(event, 'origin')
  const expected = useDeps().config.panelUrl.origin
  if (origin === expected && getRequestHeader(event, 'x-app-request') === '1') return
  const requestId = (event.context['requestId'] as string | undefined) ?? 'unknown'
  setResponseStatus(event, 403)
  setResponseHeader(event, 'content-type', 'application/json')
  return JSON.stringify({
    error: { code: 'FORBIDDEN', message: 'Richiesta non consentita.', requestId },
  })
})
