import type { NitroErrorHandler } from 'nitropack'

const GENERIC = 'Si è verificato un errore. Riprova; se continua, comunica questo codice.'

const errorHandler: NitroErrorHandler = (error, event) => {
  const requestId = (event.context['requestId'] as string | undefined) ?? 'unknown'
  const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500

  if (status >= 500) {
    // detail only in the logs
    try {
      useDeps().logger.error({ requestId, err: error }, 'unhandled error')
    } catch {
      console.error('unhandled error before startup finished', error.message)
    }
    setResponseStatus(event, 500)
    setResponseHeader(event, 'content-type', 'application/json')
    return send(event, JSON.stringify({ error: { code: 'INTERNAL', message: GENERIC, requestId } }))
  }

  const code = status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'
  const message = status === 404 ? 'Non trovato.' : 'Richiesta non valida.'
  setResponseStatus(event, status)
  setResponseHeader(event, 'content-type', 'application/json')
  return send(event, JSON.stringify({ error: { code, message, requestId } }))
}

export default errorHandler
