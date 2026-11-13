import type { PictureDownload } from '@app/application'
import { ACCOUNT_AVATAR_MAX_BYTES, ACCOUNT_AVATAR_TIMEOUT_MS } from '@app/domain'
import type { MetaMode } from './graph-client.js'

// The profile pictures of the accounts (plan 04 Task 4): Meta gives an address on its CDN, which
// expires after some days, so Feedway keeps a copy. The address comes from Meta's answer, so it
// is never trusted: only Meta's picture hosts, over https, without credentials or another port.

/** Meta's picture CDNs (verified on the recordings of 2026-11-12: `scontent*.fbcdn.net`). */
const META_PICTURE_DOMAINS = ['fbcdn.net', 'cdninstagram.com'] as const
const MAX_REDIRECTS = 3

export interface MetaPictureDownloaderOptions {
  mode: MetaMode
  /** `mock`: the fake Graph API serves the pictures, and only its address is allowed. */
  mockUrl?: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  maxBytes?: number
}

export type MetaPictureDownloader = (url: string) => Promise<PictureDownload>

const refused = { ok: false, reason: 'refused' } as const
const gone = { ok: false, reason: 'gone' } as const
const unavailable = { ok: false, reason: 'unavailable' } as const

function parse(url: string, base?: URL): URL | null {
  try {
    return new URL(url, base)
  } catch {
    return null
  }
}

function isMetaPictureHost(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    META_PICTURE_DOMAINS.some((domain) => host.endsWith(`.${domain}`))
  )
}

/** The body, stopped as soon as it passes `max` bytes; null when it does. */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel()
    return null
  }
  if (res.body === null) return Buffer.alloc(0)
  const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
}

export function createMetaPictureDownloader(
  opts: MetaPictureDownloaderOptions,
): MetaPictureDownloader {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? ACCOUNT_AVATAR_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? ACCOUNT_AVATAR_MAX_BYTES
  // in mock mode no address of the real Meta is ever reached: without the mock, nothing is
  const mockOrigin = opts.mode === 'mock' ? (parse(opts.mockUrl ?? '')?.origin ?? null) : undefined
  const allowed = (url: URL) =>
    mockOrigin === undefined
      ? isMetaPictureHost(url)
      : mockOrigin !== null && url.origin === mockOrigin

  return async (address) => {
    const first = parse(address)
    if (first === null || !allowed(first)) return refused
    let url: URL = first
    // one time limit for the whole download, redirects and body included
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      for (let hops = 0; ; hops++) {
        const res = await fetchFn(url, {
          redirect: 'manual',
          signal,
          headers: { accept: 'image/*' },
          // no cookie or referrer leaves for the CDN
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        })
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel()
          const location = res.headers.get('location')
          const next: URL | null = location === null ? null : parse(location, url)
          if (next === null || !allowed(next) || hops >= MAX_REDIRECTS) return refused
          url = next
          continue
        }
        if (res.status === 429 || res.status >= 500) {
          await res.body?.cancel()
          return unavailable
        }
        if (!res.ok) {
          await res.body?.cancel()
          return gone
        }
        const bytes = await readCapped(res, maxBytes)
        return bytes === null ? refused : { ok: true, bytes }
      }
    } catch {
      // timeout, connection refused or reset: it may pass
      return unavailable
    }
  }
}
