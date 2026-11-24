import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createExternalWatchPinger } from './external-watch-pinger.js'

// The call to healthchecks.io (plan 08 Task 9): a plain GET, codes only in the outcome.

let server: Server
let base: string
const seen: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method ?? ''} ${req.url ?? ''}`)
    if (req.url === '/slow') return // never answers
    res.statusCode = req.url === '/gone' ? 404 : 200
    res.end('OK')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

const pinger = createExternalWatchPinger()

test('a 2xx answer is a call that worked', async () => {
  const result = await pinger.ping(`${base}/ping/abc`, AbortSignal.timeout(2000))
  expect(result).toEqual({ ok: true, status: 200 })
  expect(seen).toContain('GET /ping/abc')
})

test('another status is a failure with its code', async () => {
  expect(await pinger.ping(`${base}/gone`, AbortSignal.timeout(2000))).toEqual({
    ok: false,
    problem: 'status',
    status: 404,
  })
})

test('no answer in time is a timeout', async () => {
  expect(await pinger.ping(`${base}/slow`, AbortSignal.timeout(200))).toEqual({
    ok: false,
    problem: 'timeout',
    status: null,
  })
})

test('nobody listening is a network failure, with nothing of the address', async () => {
  const result = await pinger.ping('http://127.0.0.1:1/segreto', AbortSignal.timeout(2000))
  expect(result).toEqual({ ok: false, problem: 'network', status: null })
  expect(JSON.stringify(result)).not.toContain('segreto')
})
