const UNKNOWN_BROWSER = 'Browser sconosciuto'
const UNKNOWN_OS = 'Sistema sconosciuto'

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari", iOS also says "Mac OS X".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
// User-Agent headers can be huge: only the start is matched, keeping regex work bounded.
const MAX_UA_LENGTH = 512
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

const match = (ua: string, table: [RegExp, string][], fallback: string) =>
  table.find(([re]) => re.test(ua))?.[1] ?? fallback

/** Main browser and system families from a User-Agent, without a library. */
export function deviceLabel(userAgent: string | null): { browser: string; os: string } {
  if (userAgent === null) return { browser: UNKNOWN_BROWSER, os: UNKNOWN_OS }
  const ua = userAgent.slice(0, MAX_UA_LENGTH)
  // Safari is the last browser checked; Chromium-based in-app browsers without "Version/" stay unknown.
  const browser = match(ua, BROWSERS, UNKNOWN_BROWSER)
  return {
    browser: browser === 'Safari' && !ua.includes('Version/') ? UNKNOWN_BROWSER : browser,
    os: match(ua, SYSTEMS, UNKNOWN_OS),
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

const IPV6_GROUP = /^[0-9a-f]{1,4}$/i

function expandIpv6(ip: string): string[] | null {
  if (ip.split('::').length > 2) return null
  const [head = '', tail] = ip.split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === undefined || tail === '' ? [] : tail.split(':')
  const missing = 8 - left.length - right.length
  if (tail === undefined ? missing !== 0 : missing < 1) return null
  if (![...left, ...right].every((g) => IPV6_GROUP.test(g))) return null
  return [...left, ...Array<string>(missing).fill('0'), ...right]
}

/** IPv4: last octet set to 0. IPv6: first 48 bits only. Anything else: empty. */
export function shortenIp(ip: string): string {
  const v4 = IPV4.exec(ip.replace(/^::ffff:/i, ''))
  if (v4) {
    const octets = v4.slice(1, 5).map(Number)
    return octets.every((o) => o <= 255) ? `${octets.slice(0, 3).join('.')}.0` : ''
  }
  const groups = expandIpv6(ip)
  if (groups === null) return ''
  const prefix = groups.slice(0, 3).map((g) => parseInt(g, 16).toString(16))
  while (prefix.length > 0 && prefix[prefix.length - 1] === '0') prefix.pop()
  return `${prefix.join(':')}::`
}
