import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isPublicMediaName, readPublicMediaFile } from '@app/application'
import type { MediaFile } from '@app/application'
import { parseByteRange } from '../utils/byte-range.js'
import { pathForLog } from '../utils/log-path.js'
import type { Deps } from '../utils/deps.js'

/**
 * The public host (spec §16.1, ADR 005, plan 04 Task 11): a listener of its own on PUBLIC_PORT,
 * the only port Tailscale Funnel (or the tunnel) reaches. It is not the panel's app with a
 * filter in front: nothing of the panel (pages, API, static files, session, cookies) is mounted
 * here, so the entry is told by the port and the `Host` a client sends changes nothing.
 * Only `/m/{token}.{jpg|mp4}` and `/robots.txt` answer; `/share/*` comes with stage 10.
 */

const MEDIA_PATH = /^\/m\/([^/]+)$/
/**
 * Lookups at once: each is a transaction on the pool the panel uses, so a burst of addresses
 * (the host is public and its name is in the certificate logs) cannot take it (P3, D-08). Meta
 * retries a 503.
 */
const MAX_LOOKUPS = 3
const RETRY_AFTER_SECONDS = '5'
const ROBOTS = 'User-agent: *\nDisallow: /\n'

/** On every answer, errors included: nothing to run, sniff, frame or index. */
function baseHeaders(res: ServerResponse, hsts: boolean) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-robots-tag', 'noindex, nofollow')
  res.setHeader('content-security-policy', "default-src 'none'; sandbox")
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('cross-origin-resource-policy', 'cross-origin')
  if (hsts) res.setHeader('strict-transport-security', 'max-age=31536000')
}

function text(res: ServerResponse, status: number, body: string, head: boolean) {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(head ? undefined : body)
}

/**
 * A stored file stays open until its body is read or abandoned. A stream is destroyed: the
 * `return` of an iterator that never started would not close it.
 */
function release(file: MediaFile) {
  const body = file.object.body as AsyncIterable<Uint8Array> & { destroy?: () => void }
  if (typeof body.destroy === 'function') body.destroy()
  else void body[Symbol.asyncIterator]().return?.()
}

async function sendMedia(
  req: IncomingMessage,
  res: ServerResponse,
  file: MediaFile,
  head: boolean,
): Promise<void> {
  res.setHeader('content-type', file.contentType)
  res.setHeader('accept-ranges', 'bytes')
  // short, so a deleted file is soon gone also behind a CDN (spec §16.1)
  res.setHeader('cache-control', 'public, max-age=3600')
  const tag = `"${file.etag}"`
  res.setHeader('etag', tag)
  const asked = req.headers['if-none-match'] ?? ''
  if (asked.split(',').some((t) => t.trim().replace(/^W\//, '') === tag)) {
    release(file)
    res.statusCode = 304
    res.end()
    return
  }
  let length = file.object.size
  if (file.kind === 'part') {
    const { range, size } = file.object
    if (range === null) {
      release(file)
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${String(size)}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader(
      'content-range',
      `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
    )
    length = range.end - range.start + 1
  } else res.statusCode = 200
  res.setHeader('content-length', length)
  if (head) {
    release(file)
    res.end()
    return
  }
  await pipeline(Readable.from(file.object.body), res)
}

/** The request listener of the public entry. */
export function publicHostListener(deps: Deps) {
  const hsts = deps.config.publicUrl?.protocol === 'https:'
  let lookups = 0
  return (req: IncomingMessage, res: ServerResponse): void => {
    const started = Date.now()
    const requestId = deps.ids.newId()
    res.setHeader('x-request-id', requestId)
    baseHeaders(res, hsts)
    const method = req.method ?? 'GET'
    const head = method === 'HEAD'
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const media = MEDIA_PATH.exec(path)
    // never the token in the log: whoever reads the log could fetch the file
    const logged = pathForLog(req.url ?? '/')
    res.once('close', () => {
      deps.logger.info(
        {
          requestId,
          method,
          path: logged,
          status: res.statusCode,
          durationMs: Date.now() - started,
          entry: 'public',
        },
        'request',
      )
    })
    const serve = async () => {
      if (path === '/robots.txt' || media) {
        if (method !== 'GET' && !head) {
          res.setHeader('allow', 'GET, HEAD')
          text(res, 405, 'Method Not Allowed', false)
          return
        }
        if (!media) {
          text(res, 200, ROBOTS, head)
          return
        }
        const name = media[1] ?? ''
        if (isPublicMediaName(name) && lookups >= MAX_LOOKUPS) {
          res.setHeader('retry-after', RETRY_AFTER_SECONDS)
          text(res, 503, 'Service Unavailable', head)
          return
        }
        const header = req.headers.range
        lookups += 1
        let file: MediaFile | null
        try {
          file = await readPublicMediaFile(deps, {
            name,
            range: parseByteRange(Array.isArray(header) ? undefined : header),
          })
        } finally {
          lookups -= 1
        }
        if (!file) {
          text(res, 404, 'Not Found', head)
          return
        }
        await sendMedia(req, res, file, head)
        return
      }
      // anything else, the panel's paths and /share/ included, is not here
      if (method !== 'GET' && !head) {
        res.setHeader('allow', 'GET, HEAD')
        text(res, 405, 'Method Not Allowed', false)
        return
      }
      text(res, 404, 'Not Found', head)
    }
    serve().catch((error: unknown) => {
      // a client that went away in the middle of a file is not a failure of ours
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET') return
      deps.logger.error({ err: error, requestId, entry: 'public' }, 'public request failed')
      if (res.headersSent) res.destroy()
      else text(res, 500, 'Internal Server Error', head)
    })
  }
}
