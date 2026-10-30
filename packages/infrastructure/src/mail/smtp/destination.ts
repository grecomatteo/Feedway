import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { SmtpSendError } from './smtp-error.js'

/** Every address a name resolves to. */
export type Resolve = (host: string) => Promise<string[]>

export const systemResolve: Resolve = async (host) =>
  (await lookup(host, { all: true, order: 'verbatim' })).map((a) => a.address)

const DNS_TIMEOUT_MS = 5_000

// Addresses an Owner must never make the server connect to (SSRF): this host, the private
// networks of the VPS and of Tailscale (CGNAT), link-local (cloud metadata), multicast,
// reserved and documentation ranges.
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]
// IPv6: only global unicast (2000::/3) is reachable, minus the ranges that embed or translate
// an IPv4 address (6to4, Teredo, NAT64) and the documentation and benchmarking ranges. Loopback,
// unspecified, IPv4-mapped, unique local (fc00::/7), link-local and multicast are all outside
// 2000::/3.
const BLOCKED_V6: [string, number][] = [
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
]

const blocked = new BlockList()
for (const [net, prefix] of BLOCKED_V4) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of BLOCKED_V6) blocked.addSubnet(net, prefix, 'ipv6')
const globalUnicast = new BlockList()
globalUnicast.addSubnet('2000::', 3, 'ipv6')

/** Whether the server may open a connection to this address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6) return globalUnicast.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
  return false
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A DNS name with at least two labels. IP literals are refused: the certificate is verified
 * against the name, and an address typed in the panel would skip the name entirely.
 */
export function normalizeHostName(host: string): string | null {
  const name = host.trim().toLowerCase()
  if (name.length === 0 || name.length > 253 || isIP(name) !== 0) return null
  const labels = name.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null
  // the last label of a public name is never all digits
  if (/^\d+$/.test(labels.at(-1) ?? '')) return null
  return name
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('dns timeout'))
      }, ms)
    }),
  ]).finally(() => {
    clearTimeout(timer)
  })
}

export interface Destination {
  /** The verified address the connection goes to: a second lookup cannot change it. */
  address: string
  /** The name the certificate must match (SNI and hostname check). */
  servername: string
}

/**
 * Resolves the host once and refuses it when any of its addresses is not public: a name that
 * answers with one public and one private address could be steered to the private one.
 */
export async function resolveDestination(
  host: string,
  opts: { resolve: Resolve; timeoutMs?: number },
): Promise<Destination> {
  const servername = normalizeHostName(host)
  if (servername === null) throw new SmtpSendError('invalid_config')
  let addresses: string[]
  try {
    addresses = await withTimeout(opts.resolve(servername), opts.timeoutMs ?? DNS_TIMEOUT_MS)
  } catch {
    throw new SmtpSendError('dns')
  }
  const [first] = addresses
  if (first === undefined) throw new SmtpSendError('dns')
  if (!addresses.every(isPublicAddress)) throw new SmtpSendError('blocked_destination')
  return { address: first, servername }
}
