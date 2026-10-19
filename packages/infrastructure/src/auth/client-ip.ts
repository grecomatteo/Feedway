import { isIP } from 'node:net'

/**
 * The address of the person on the other side. The proxy in front of the panel (Tailscale serve)
 * appends or sets the address it saw as the last `X-Forwarded-For` entry, so only that entry is
 * trustworthy: anything before it was written by the client. Without the header (no proxy,
 * tests) the connection address counts.
 */
export function clientIp(headers: Headers, remoteAddress: string | undefined): string | null {
  const forwarded = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const address = forwarded?.at(-1) ?? remoteAddress
  if (address === undefined || address === '') return null
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  // anything else would break the inet column of the activity log (and is not an address)
  return isIP(plain) === 0 ? null : plain
}
