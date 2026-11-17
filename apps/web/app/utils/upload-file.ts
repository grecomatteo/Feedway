// What the panel checks of a file before uploading it (plan 04 Task 13, spec §11.1): the type
// Feedway takes and the limit of its kind, so a wrong file is refused at once, with the reason,
// without stopping the others. The server checks again; the bytes decide at `complete`.

/** As UPLOAD_DECLARED_TYPES in @app/domain: the panel imports nothing of the server's packages. */
const TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov', 'qt'],
} as const

/** 20 MiB, as UPLOAD_PART_MAX_BYTES in @app/contracts (a test checks they agree). */
export const PART_BYTES = 20 * 1024 * 1024

export type UploadType = keyof typeof TYPES
export type UploadKind = 'image' | 'video'

/** For `<input accept>`: the types and, for the browsers that know no HEIC, the extensions. */
export const UPLOAD_ACCEPT = [
  ...Object.keys(TYPES),
  ...Object.values(TYPES).flatMap((exts) => exts.map((e) => `.${e}`)),
].join(',')

export interface UploadLimits {
  maxImageBytes: number
  maxVideoBytes: number
}

const isUploadType = (type: string): type is UploadType => Object.hasOwn(TYPES, type)

/** The type to declare: the browser's, else from the extension (Chrome on Windows gives a HEIC none). */
export function declaredTypeOf(file: { name: string; type: string }): UploadType | null {
  const type = file.type.toLowerCase()
  if (isUploadType(type)) return type
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  if (!ext) return null
  for (const [t, exts] of Object.entries(TYPES))
    if ((exts as readonly string[]).includes(ext)) return t as UploadType
  return null
}

export const kindOf = (type: UploadType): UploadKind =>
  type.startsWith('video/') ? 'video' : 'image'

export type FileCheck =
  | { ok: true; type: UploadType; kind: UploadKind }
  | { ok: false; reason: 'type' }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'size'; kind: UploadKind; limit: number }

export function checkUploadFile(
  file: { name: string; type: string; size: number },
  limits: UploadLimits,
): FileCheck {
  const type = declaredTypeOf(file)
  if (!type) return { ok: false, reason: 'type' }
  if (file.size <= 0) return { ok: false, reason: 'empty' }
  const kind = kindOf(type)
  const limit = kind === 'video' ? limits.maxVideoBytes : limits.maxImageBytes
  if (file.size > limit) return { ok: false, reason: 'size', kind, limit }
  return { ok: true, type, kind }
}

/** Piece `n` (from 1) of a file, as the server cuts it. */
export function partSlice(n: number, size: number, partBytes: number) {
  const start = (n - 1) * partBytes
  return { start, end: Math.min(size, start + partBytes) }
}

export function missingParts(partCount: number, received: readonly number[]): number[] {
  const have = new Set(received)
  const out: number[] = []
  for (let n = 1; n <= partCount; n++) if (!have.has(n)) out.push(n)
  return out
}

/** `Content-Digest` of a piece (RFC 9530), as the server reads it. */
export function contentDigest(sha256: Uint8Array): string {
  let binary = ''
  for (const byte of sha256) binary += String.fromCharCode(byte)
  return `sha-256=:${btoa(binary)}:`
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** A file chosen again after a reload is the one left halfway: same name, size and first piece. */
export function sameFile(
  upload: { name: string; sizeBytes: number; firstPartSha256: string },
  file: { name: string; size: number },
  firstPartSha256: string,
): boolean {
  return (
    upload.name === file.name &&
    upload.sizeBytes === file.size &&
    upload.firstPartSha256 === firstPartSha256
  )
}

/** A picture pasted with Ctrl/Cmd+V has no name of its own («image.png»): one with the time. */
export function pastedFileName(type: string, at: Date): string {
  const ext =
    declaredTypeOf({ name: '', type }) === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'png')
  const p = (n: number) => String(n).padStart(2, '0')
  const day = `${String(at.getFullYear())}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
  const time = `${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}`
  return `Incollata ${day} ${time}.${ext}`
}

/** The time left, for people. */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 10) return 'pochi secondi'
  if (s < 60) return `${String(s)} s`
  const minutes = Math.round(s / 60)
  if (minutes < 60) return `${String(minutes)} min`
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`
}

/** Bytes per second over the last `windowMs`: a pause or a slow start does not weigh for ever. */
export function rateMeter(windowMs: number) {
  let samples: { at: number; bytes: number }[] = []
  return {
    add(at: number, bytes: number) {
      samples.push({ at, bytes })
      samples = samples.filter((s) => s.at >= at - windowMs)
    },
    rate(): number | null {
      const first = samples[0]
      const last = samples.at(-1)
      if (!first || !last || last.at <= first.at) return null
      return ((last.bytes - first.bytes) * 1000) / (last.at - first.at)
    },
    reset() {
      samples = []
    },
  }
}

/**
 * Calls `changed` when the network comes back (`online`) or changes under the page (Wi-Fi to 5G,
 * which `online` does not tell: the Network Information API, where the browser has it). A request
 * on the old connection may hang with no error, so the uploads start again (D-41).
 */
export function onNetworkChange(
  changed: () => void,
  on: {
    win: EventTarget
    connection: EventTarget | undefined
  } = {
    win: window,
    connection: (navigator as Navigator & { connection?: EventTarget }).connection,
  },
): () => void {
  on.win.addEventListener('online', changed)
  on.connection?.addEventListener('change', changed)
  return () => {
    on.win.removeEventListener('online', changed)
    on.connection?.removeEventListener('change', changed)
  }
}

/**
 * Calls `stalled` once when `poke` has not come for `ms`: a request that hangs with no error
 * (the network changed, the tab was suspended) is given up instead of waited for ever.
 */
export function stallTimer(ms: number, stalled: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const arm = () => {
    clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(() => {
      stopped = true
      stalled()
    }, ms)
  }
  arm()
  return {
    poke: arm,
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

/**
 * Tells a network too slow for a piece: the same piece fell twice in a row after sending for at
 * least `slowMs` (the panel's server gives a request 300 s, plan 04 P1 bis). A quick fall is a
 * network that comes and goes, and starts the count again.
 */
export function slowPieces(slowMs: number) {
  let piece: number | null = null
  let falls = 0
  return {
    /** A fall of piece `n` after `elapsedMs` of sending: true when the network is too slow. */
    failed(n: number, elapsedMs: number): boolean {
      if (elapsedMs < slowMs) {
        piece = null
        falls = 0
        return false
      }
      if (piece !== n) {
        piece = n
        falls = 0
      }
      falls += 1
      return falls >= 2
    },
    arrived() {
      piece = null
      falls = 0
    },
  }
}
