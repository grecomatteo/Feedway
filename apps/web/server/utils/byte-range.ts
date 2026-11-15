import type { ByteRange } from '@app/application'

const RANGE = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i

/**
 * The one byte range of an HTTP `Range` header. Anything else (no header, several ranges, a
 * unit other than bytes, a malformed or reversed range) is null: the whole file is sent, as
 * RFC 9110 allows a server to do.
 */
export function parseByteRange(header: string | undefined): ByteRange | null {
  const match = RANGE.exec(header ?? '')
  if (!match) return null
  const [, first = '', last = ''] = match
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
