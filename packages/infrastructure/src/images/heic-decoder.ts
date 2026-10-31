import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

export type HeicDecodeResult =
  | { ok: true; data: Buffer; width: number; height: number }
  | { ok: false; reason: 'unreadable' | 'too_many_pixels' | 'timeout' }

// Runs in its own thread: libheif-js decodes in WebAssembly on the calling thread, and its
// memory only grows. A thread per photo keeps the server answering meanwhile, and its memory
// goes back to the system when the thread ends.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const libheif = require(workerData.module)
const decoder = new libheif.HeifDecoder()
const images = decoder.decode(workerData.bytes)
const image = images.find((i) => i.is_primary()) || images[0]
if (!image) parentPort.postMessage({ ok: false, reason: 'unreadable' })
else {
  const width = image.get_width()
  const height = image.get_height()
  if (!(width > 0 && height > 0)) parentPort.postMessage({ ok: false, reason: 'unreadable' })
  else if (width * height > workerData.maxPixels)
    parentPort.postMessage({ ok: false, reason: 'too_many_pixels' })
  else {
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height }
    image.display(target, (decoded) => {
      if (!decoded) parentPort.postMessage({ ok: false, reason: 'unreadable' })
      else parentPort.postMessage({ ok: true, data: decoded.data, width, height }, [decoded.data.buffer])
    })
  }
}
`

// Resolved on first use: in the bundled server, a chunk can run before the entry sets its own
// module URL, and resolving then would look for the library from the wrong place.
let libheifPath: string | undefined
const libheif = () =>
  (libheifPath ??= createRequire(import.meta.url).resolve('libheif-js/wasm-bundle.js'))

/**
 * Raw RGBA pixels of the primary image of a HEIC. The size is read from the header and checked
 * before anything is decoded; a decode that takes longer than `timeoutMs` is stopped.
 */
export function decodeHeic(
  bytes: Buffer,
  opts: { maxPixels: number; timeoutMs: number },
): Promise<HeicDecodeResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { module: libheif(), bytes, maxPixels: opts.maxPixels },
      // libheif prints its parse errors: they are the photo's, not ours
      stdout: true,
      stderr: true,
    })
    let settled = false
    const finish = (result: HeicDecodeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'timeout' })
    }, opts.timeoutMs)
    worker.once(
      'message',
      (
        m:
          | { ok: true; data: Uint8ClampedArray; width: number; height: number }
          | { ok: false; reason: 'unreadable' | 'too_many_pixels' },
      ) => {
        finish(
          m.ok
            ? {
                ok: true,
                data: Buffer.from(m.data.buffer, m.data.byteOffset, m.data.byteLength),
                width: m.width,
                height: m.height,
              }
            : m,
        )
      },
    )
    worker.once('error', () => {
      finish({ ok: false, reason: 'unreadable' })
    })
    worker.once('exit', () => {
      finish({ ok: false, reason: 'unreadable' })
    })
  })
}
