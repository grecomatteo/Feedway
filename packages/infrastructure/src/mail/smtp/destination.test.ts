import { expect, test } from 'vitest'
import { isPublicAddress, resolveDestination } from './destination.js'

test.each([
  '127.0.0.1',
  '127.1.2.3',
  '10.0.0.5',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '100.127.255.255',
  '0.0.0.0',
  '224.0.0.1',
  '239.255.255.250',
  '255.255.255.255',
  '192.0.2.10',
  '198.18.0.1',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '::ffff:10.0.0.1',
  '::ffff:8.8.8.8',
  '64:ff9b::a00:1',
  '2002:a00:1::1',
  '2001:0:4136:e378::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'ff02::1',
  '2001:db8::1',
  'not an address',
])('%s is refused', (address) => {
  expect(isPublicAddress(address)).toBe(false)
})

test.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2a00:1450:4002:402::201a'])(
  '%s is accepted',
  (address) => {
    expect(isPublicAddress(address)).toBe(true)
  },
)

const resolvesTo =
  (...addresses: string[]) =>
  () =>
    Promise.resolve(addresses)

test('a public name gives its verified address and keeps the name for the certificate', async () => {
  await expect(
    resolveDestination('SMTP.Example.com', { resolve: resolvesTo('203.0.114.7') }),
  ).resolves.toEqual({ address: '203.0.114.7', servername: 'smtp.example.com' })
})

test.each([['127.0.0.1'], ['10.1.2.3'], ['8.8.8.8', '192.168.0.10'], ['::1']])(
  'a name that resolves to %s (or also to it) is refused',
  async (...addresses) => {
    await expect(
      resolveDestination('smtp.example.com', { resolve: resolvesTo(...addresses) }),
    ).rejects.toMatchObject({ kind: 'blocked_destination' })
  },
)

test.each(['127.0.0.1', '8.8.8.8', '[::1]', 'localhost', 'smtp', 'a..b.com', '-x.com', 'x.com:25'])(
  'the host %s is not a usable name',
  async (host) => {
    await expect(
      resolveDestination(host, { resolve: resolvesTo('8.8.8.8') }),
    ).rejects.toMatchObject({ kind: 'invalid_config' })
  },
)

test('a name that does not resolve, or too slowly, is a dns failure', async () => {
  await expect(
    resolveDestination('smtp.example.com', {
      resolve: () => Promise.reject(new Error('ENOTFOUND')),
    }),
  ).rejects.toMatchObject({ kind: 'dns' })
  await expect(
    resolveDestination('smtp.example.com', { resolve: resolvesTo() }),
  ).rejects.toMatchObject({ kind: 'dns' })
  await expect(
    resolveDestination('smtp.example.com', {
      resolve: () => new Promise(() => undefined),
      timeoutMs: 20,
    }),
  ).rejects.toMatchObject({ kind: 'dns' })
})
