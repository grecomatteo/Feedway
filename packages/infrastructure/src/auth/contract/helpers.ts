import { createHmac } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  let bits = ''
  for (const c of input.replace(/=+$/, '').toUpperCase())
    bits += B32.indexOf(c).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s), computed independently of the library under test. */
export function totpCode(base32Secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', base32Decode(base32Secret)).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return String(n).padStart(6, '0')
}

export function secretOf(totpURI: string): string {
  return new URL(totpURI).searchParams.get('secret')!
}

/** "name=value" pairs of Set-Cookie headers, as a Cookie request header. */
export function cookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(';')[0]).join('; ')
}

export function parseSetCookie(raw: string) {
  const [pair = '', ...attrs] = raw.split(';').map((s) => s.trim())
  const eq = pair.indexOf('=')
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    attributes: attrs.map((a) => a.toLowerCase()),
  }
}
