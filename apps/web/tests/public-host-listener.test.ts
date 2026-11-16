import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, test } from 'vitest'
import { publicHostListener } from '../server/public-host/listener.ts'
import type { Deps } from '../server/utils/deps.ts'

// The public host and the database it shares with the panel (revisione tappa 4, P3): at most
// three lookups at once, the others are told to come back, so a burst of addresses cannot take
// the connections the panel needs.

let server: Server | null = null

afterEach(async () => {
  const s = server
  server = null
  if (s) await new Promise((resolve) => s.close(resolve))
})

const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

/** A host whose lookups wait for `open`. */
async function hostWithSlowLookups() {
  let open: () => void = () => undefined
  const opened = new Promise<void>((resolve) => (open = resolve))
  let lookups = 0
  const deps = {
    config: { publicUrl: new URL('https://media.example.ts.net') },
    ids: { newId: () => '00000000-0000-7000-8000-000000000000' },
    logger: silent,
    storage: {},
    uow: {
      runAsSystem: async () => {
        lookups += 1
        await opened
        return null
      },
    },
  } as unknown as Deps
  const s = createServer(publicHostListener(deps))
  server = s
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${String((s.address() as AddressInfo).port)}`
  return { url, open, lookups: () => lookups }
}

const token = (n: number) => `${String(n).padStart(2, '0')}${'a'.repeat(30)}.jpg`

test('a fourth lookup at once is told to come back in a few seconds; the others answer', async () => {
  const host = await hostWithSlowLookups()
  const first = [1, 2, 3].map((n) => fetch(`${host.url}/m/${token(n)}`))
  await expect.poll(() => host.lookups()).toBe(3)
  const fourth = await fetch(`${host.url}/m/${token(4)}`)
  expect(fourth.status).toBe(503)
  expect(fourth.headers.get('retry-after')).toBe('5')
  expect(host.lookups()).toBe(3)
  host.open()
  for (const r of await Promise.all(first)) expect(r.status).toBe(404)
  // the places are free again
  expect((await fetch(`${host.url}/m/${token(5)}`)).status).toBe(404)
})

test('robots.txt and a name of the wrong form never wait for a place', async () => {
  const host = await hostWithSlowLookups()
  const busy = [1, 2, 3].map((n) => fetch(`${host.url}/m/${token(n)}`))
  await expect.poll(() => host.lookups()).toBe(3)
  expect((await fetch(`${host.url}/robots.txt`)).status).toBe(200)
  expect((await fetch(`${host.url}/m/corto.jpg`)).status).toBe(404)
  host.open()
  await Promise.all(busy)
})
