import type { IncomingMessage } from 'node:http'

const PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** JSON and forms; a route can accept less (defineApiRoute, 16 KiB by default). */
const MAX_BODY_BYTES = 1024 * 1024
/** As nuxt-security's upload limit, which only covers POST, PUT and DELETE. */
const MAX_MULTIPART_BYTES = 8_000_000
// where h3 caches the body it read: readBody, readRawBody and toWebRequest all use it
const RAW_BODY = Symbol.for('h3RawBody')

/** The body, `null` past the limit, `'aborted'` when the client went away before the end. */
function readCapped(req: IncomingMessage, max: number): Promise<Buffer | null | 'aborted'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) {
        // stop buffering: the rest is discarded, and the socket closes after the answer
        req.removeAllListeners('data')
        req.resume()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (error: NodeJS.ErrnoException) => {
      // an abandoned upload is the client's choice, not a failure of ours
      if (req.destroyed || error.code === 'ECONNRESET') resolve('aborted')
      else reject(error)
    })
    req.on('close', () => {
      if (!req.complete) resolve('aborted')
    })
  })
}

/**
 * Bounds every request body before anything reads it. nuxt-security checks only the declared
 * Content-Length (and not on PATCH), while its XSS validator reads every POST body whole: a
 * chunked body has no length and would be buffered without limit. A body with a length is
 * bounded by Node itself, which reads exactly that many bytes.
 */
export default defineEventHandler(async (event) => {
  if (!PAYLOAD_METHODS.has(event.method)) return
  // the media type itself: `application/json; x=multipart/form-data` is not an upload
  const mediaType = (getRequestHeader(event, 'content-type') ?? '').split(';')[0] ?? ''
  const multipart = mediaType.trim().toLowerCase() === 'multipart/form-data'
  const max = multipart ? MAX_MULTIPART_BYTES : MAX_BODY_BYTES
  const tooLarge = () => {
    setResponseHeader(event, 'connection', 'close')
    return sendApiError(event, new HttpProblem('REQUEST_TOO_LARGE'))
  }
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > max) return tooLarge()
  if (!/\bchunked\b/i.test(getRequestHeader(event, 'transfer-encoding') ?? '')) return
  const req = event.node.req as IncomingMessage & { [RAW_BODY]?: Promise<Buffer> }
  const body = await readCapped(req, max)
  if (body === null) return tooLarge()
  if (body === 'aborted') {
    useDeps().logger.info({ requestId: requestIdOf(event) }, 'request aborted by the client')
    setResponseStatus(event, 400)
    return ''
  }
  req[RAW_BODY] = Promise.resolve(body)
})
