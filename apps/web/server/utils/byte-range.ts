import type { ByteRange } from '@app/application'

const DIGITS = /^\d*$/

/** Far longer than any single range; a longer header is not one we serve. */
const MAX_HEADER = 200

/**
 * The one byte range of an HTTP `Range` header. Anything else (no header, several ranges, a
 * unit other than bytes, a malformed or reversed range) is null: the whole file is sent, as
 * RFC 9110 allows a server to do.
 */
export function parseByteRange(header: string | undefined): ByteRange | null {
  if (header === undefined || header.length > MAX_HEADER) return null
  // Split by hand: a regex with `\s*` around each part backtracks quadratically.
  const equals = header.indexOf('=')
  if (equals < 0 || header.slice(0, equals).trim().toLowerCase() !== 'bytes') return null
  const spec = header.slice(equals + 1)
  const dash = spec.indexOf('-')
  if (dash < 0) return null
  const first = spec.slice(0, dash).trim()
  const last = spec.slice(dash + 1).trim()
  if (!DIGITS.test(first) || !DIGITS.test(last)) return null
  const whole = (digits: string) => {
    const n = Number(digits)
    return Number.isSafeInteger(n) ? n : null
  }
  if (first === '') {
    const suffix = whole(last)
    return last === '' || suffix === null || suffix === 0 ? null : { suffix }
  }
  const start = whole(first)
  if (start === null) return null
  if (last === '') return { start, end: null }
  const end = whole(last)
  return end === null || end < start ? null : { start, end }
}
