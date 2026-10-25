import { STATUS_CODES } from 'node:http'
import type { H3Event } from 'h3'
import type { NitroErrorHandler } from 'nitropack'

/** The standard phrase: the renderer's own would repeat the requested path. */
const setStatus = (event: H3Event, status: number) => {
  setResponseStatus(event, status, STATUS_CODES[status] ?? 'Error')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// headers of the rendered error page that belong to the inner request, not to this answer
const SKIP_HEADERS = new Set(['x-request-id', 'content-length', 'set-cookie', 'cache-control'])

/** A page for a person in a browser; everything under /api answers JSON whatever it accepts. */
const wantsPage = (event: H3Event) =>
  !event.path.startsWith('/api/') &&
  (getRequestHeader(event, 'accept') ?? '').toLowerCase().includes('text/html')

type InternalRequest = { __unenv__?: { nuxt?: Record<string, unknown> } }

/** The error page itself failed: Nuxt marks its own inner request, which no client can set. */
function renderingError(event: H3Event): boolean {
  const fetched = (event.node.req as InternalRequest).__unenv__?.nuxt
  const nuxt = event.context['nuxt'] as Record<string, unknown> | undefined
  return nuxt?.['~rendering-error'] === true || fetched?.['~rendering-error'] === true
}

/** Last resort, when app/error.vue cannot render: no script, no detail, the request id only. */
function staticPage(status: number, requestId: string): string {
  const title = status === 404 ? 'Pagina non trovata' : 'Qualcosa è andato storto'
  const code = UUID.test(requestId)
    ? `<p>Codice per l’assistenza: <code>${requestId}</code></p>`
    : ''
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;margin:2rem;color:#242321;background:#FAF9F6"><h1>${title}</h1>${code}<p><a href="/">Torna alla home</a></p></body></html>`
}

/**
 * The branded page (app/error.vue), rendered the way Nuxt renders it, but from our own values
 * only: the status and the request id. Never the error's message, stack or data.
 */
async function sendErrorPage(event: H3Event, status: number, requestId: string) {
  if (!renderingError(event)) {
    event.context['nuxt'] = {
      ...(event.context['nuxt'] as Record<string, unknown> | undefined),
      '~rendering-error': true,
    }
    const query = new URLSearchParams({
      // the renderer resolves the route from it; the page never shows it
      url: event.path.split('?')[0] ?? '/',
      statusCode: String(status),
      statusMessage: 'Error',
      message: '',
      data: JSON.stringify({ requestId }),
    })
    const init = {
      headers: event.headers,
      redirect: 'manual',
      context: { nuxt: { '~rendering-error': true } },
    } as RequestInit
    const page = await useNitroApp()
      .localFetch(`/__nuxt_error?${query.toString()}`, init)
      .catch(() => null)
    if (page?.ok || page?.status === status) {
      for (const [name, value] of page.headers.entries())
        if (!SKIP_HEADERS.has(name)) setResponseHeader(event, name, value)
      setStatus(event, status)
      setResponseHeader(event, 'cache-control', 'no-store')
      return send(event, await page.text())
    }
  }
  setStatus(event, status)
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(
    event,
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  )
  return send(event, staticPage(status, requestId))
}

/** Errors that no route answered itself: unknown paths, middleware, framework, crashes. */
const errorHandler: NitroErrorHandler = (error, event) => {
  const requestId = requestIdOf(event)
  const answer = toErrorResponse(error, requestId)
  if (answer.unexpected) logFailure(event, error)
  if (wantsPage(event)) return sendErrorPage(event, answer.status, requestId)
  setStatus(event, answer.status)
  for (const [name, value] of Object.entries(answer.headers)) setResponseHeader(event, name, value)
  setResponseHeader(event, 'content-type', 'application/json')
  setResponseHeader(event, 'cache-control', 'no-store')
  return send(event, JSON.stringify(answer.body))
}

export default errorHandler
