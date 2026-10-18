import { expect, test } from 'vitest'
import { deviceLabel, shortenIp } from './device.js'

test.each([
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    { browser: 'Safari', os: 'iOS' },
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
    { browser: 'Chrome', os: 'Windows' },
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
    { browser: 'Edge', os: 'Windows' },
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
    { browser: 'Firefox', os: 'macOS' },
  ],
  [
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36',
    { browser: 'Chrome', os: 'Android' },
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 OPR/120.0',
    { browser: 'Opera', os: 'Linux' },
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/141.0 Mobile/15E148 Safari/604.1',
    { browser: 'Chrome', os: 'iOS' },
  ],
  ['curl/8.0', { browser: 'Browser sconosciuto', os: 'Sistema sconosciuto' }],
  [null, { browser: 'Browser sconosciuto', os: 'Sistema sconosciuto' }],
])('device label of %s', (ua, expected) => {
  expect(deviceLabel(ua)).toEqual(expected)
})

test('ip shortening', () => {
  expect(shortenIp('93.41.12.200')).toBe('93.41.12.0')
  expect(shortenIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::')
  expect(shortenIp('::1')).toBe('::')
  expect(shortenIp('2001:db8::')).toBe('2001:db8::')
  expect(shortenIp('::ffff:93.41.12.200')).toBe('93.41.12.0')
  expect(shortenIp('not-an-ip')).toBe('')
})

test('malformed addresses become empty', () => {
  for (const ip of [':1::', '12345::', '999.1.1.1', '1:::2', '1:2::3:', 'fe80::1%eth0', '']) {
    expect(shortenIp(ip)).toBe('')
  }
})

test('huge User-Agent is matched only at its start and stays fast', () => {
  const ua = `Mozilla/5.0 (Macintosh) Version/${'1'.repeat(16_000)}`
  const start = performance.now()
  expect(deviceLabel(ua)).toEqual({ browser: 'Browser sconosciuto', os: 'macOS' })
  expect(performance.now() - start).toBeLessThan(50)
})
