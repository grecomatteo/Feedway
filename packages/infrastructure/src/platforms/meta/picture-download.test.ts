import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createMetaPictureDownloader } from './picture-download.js'

// The download of the account pictures (plan 04 Task 4), against the fake Graph API, which
// serves the pictures from itself. No database: unit project.

let mock: MetaMock

beforeEach(async () => {
  mock = await startMetaMock()
})

afterEach(async () => {
  await mock.stop()
})

const urlOf = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const picture = (name: string) => `${mock.url}/pictures/${name}.jpg?oh=aa11&oe=6A00`

test('a picture of the mock is read whole in mock mode', async () => {
  const download = createMetaPictureDownloader({ mode: 'mock', mockUrl: mock.url })
  const result = await download(picture('forno'))
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
})

test('in mock mode no other host is reached, Meta included', async () => {
  const calls: string[] = []
  const download = createMetaPictureDownloader({
    mode: 'mock',
    mockUrl: mock.url,
    fetch: (input) => {
      calls.push(urlOf(input))
      return Promise.reject(new Error('no network'))
    },
  })
  expect(await download('https://scontent.xx.fbcdn.net/p.jpg')).toEqual({
    ok: false,
    reason: 'refused',
  })
  expect(calls).toEqual([])
})

test('outside mock mode only https on Meta picture hosts is allowed, before any request', async () => {
  const calls: string[] = []
  const download = createMetaPictureDownloader({
    mode: 'live',
    fetch: (input) => {
      calls.push(urlOf(input))
      return Promise.resolve(new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200 }))
    },
  })
  for (const url of [
    'http://scontent.xx.fbcdn.net/p.jpg',
    'https://fbcdn.net.example.test/p.jpg',
    'https://evilfbcdn.net/p.jpg',
    'https://scontent.xx.fbcdn.net:8443/p.jpg',
    'https://user:pass@scontent.xx.fbcdn.net/p.jpg',
    'https://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
    'not an address',
  ])
    expect(await download(url), url).toEqual({ ok: false, reason: 'refused' })
  expect(calls).toEqual([])

  expect((await download('https://scontent-fra5-1.xx.fbcdn.net/v/p.jpg?oh=1')).ok).toBe(true)
  expect((await download('https://scontent.cdninstagram.com/v/p.jpg')).ok).toBe(true)
  expect(calls).toHaveLength(2)
})

test('a redirect to another host is refused without following it', async () => {
  const download = createMetaPictureDownloader({ mode: 'mock', mockUrl: mock.url })
  mock.scenario('picture_redirect', { to: 'https://elsewhere.example.test/x.jpg' })
  expect(await download(picture('forno'))).toEqual({ ok: false, reason: 'refused' })
  expect(mock.calls().filter((c) => c.path.startsWith('/pictures/'))).toHaveLength(1)
})

test('a redirect inside the allowed hosts is followed', async () => {
  const download = createMetaPictureDownloader({ mode: 'mock', mockUrl: mock.url })
  mock.scenario('picture_redirect', { to: '/pictures/bottega.jpg', picture: 'forno' })
  expect((await download(picture('forno'))).ok).toBe(true)
})

test('an expired address is gone; a CDN error or a slow answer is unavailable', async () => {
  const download = createMetaPictureDownloader({ mode: 'mock', mockUrl: mock.url, timeoutMs: 200 })
  expect(await download(picture('unknown'))).toEqual({ ok: false, reason: 'gone' })
  mock.scenario('html_5xx', { path: '/pictures/forno.jpg', times: 1 })
  expect(await download(picture('forno'))).toEqual({ ok: false, reason: 'unavailable' })
  mock.scenario('timeout', { path: '/pictures/forno.jpg', times: 1, delayMs: 1000 })
  expect(await download(picture('forno'))).toEqual({ ok: false, reason: 'unavailable' })
})

test('a picture over the size limit is refused, declared or not', async () => {
  const declared = createMetaPictureDownloader({ mode: 'mock', mockUrl: mock.url, maxBytes: 100 })
  expect(await declared(picture('forno'))).toEqual({ ok: false, reason: 'refused' })

  const streamed = createMetaPictureDownloader({
    mode: 'live',
    maxBytes: 100,
    fetch: () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(64))
            },
          }),
          { status: 200 },
        ),
      ),
  })
  expect(await streamed('https://scontent.xx.fbcdn.net/p.jpg')).toEqual({
    ok: false,
    reason: 'refused',
  })
})
