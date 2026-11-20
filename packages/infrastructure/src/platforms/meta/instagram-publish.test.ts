import { createHmac } from 'node:crypto'
import {
  PublishError,
  type Logger,
  type PlatformPublisher,
  type PublishFiles,
  type PublishMetaIds,
  type PublishTarget,
  type StepContext,
  type StepResult,
} from '@app/application'
import type { PostType } from '@app/domain'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fixedClock } from '../../testing/index.js'
import { createMetaGraphClient } from './graph-client.js'
import { createMetaPublishers } from './publisher.js'

// Instagram's publishing against the fake Graph API (plan 07, Task 4). No database: unit project.

let mock: MetaMock
let clock: ReturnType<typeof fixedClock>
let publisher: PlatformPublisher
let lines: string[]
let saved: PublishMetaIds[]

const ig = META_MOCK.instagram.ofPage
const token = META_MOCK.tokens.systemUser

function memoryLogger(): Logger {
  const log: Logger = {
    debug: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    info: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    warn: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    error: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    child: () => log,
  }
  return log
}

beforeEach(async () => {
  mock = await startMetaMock()
  lines = []
  saved = []
  // the mock stamps the posts with the real time: the clock starts there
  clock = fixedClock(new Date())
  const client = createMetaGraphClient({
    mode: 'mock',
    version: 'v25.0',
    baseUrl: mock.url,
    clock,
    logger: memoryLogger(),
    timeoutMs: 300,
    retryBaseDelayMs: 1,
  })
  const ready = createMetaPublishers({ client, clock }).instagram
  if (ready === undefined) throw new Error('no Instagram publisher')
  publisher = ready
})

afterEach(async () => {
  await mock.stop()
})

function target(type: PostType, over: Partial<PublishTarget> = {}): PublishTarget {
  return {
    targetId: 'target-1',
    account: { platform: 'instagram', externalId: ig, pageId: META_MOCK.pages.withInstagram },
    credentials: {
      app: { appId: META_MOCK.app.id, appSecret: META_MOCK.app.secret, version: new Date() },
      token,
    },
    type,
    asVideo: false,
    caption: type === 'story' ? '' : 'Pane caldo\n alle 7',
    shareToFeed: true,
    metaIds: null,
    externalPostId: null,
    ...over,
  }
}

const image = () => ({ kind: 'image' as const, url: `${mock.url}/pictures/forno.jpg` })
const video = () => ({ kind: 'video' as const, url: `${mock.url}/pictures/forno.jpg?v=1` })
const files = (items: PublishFiles['items'], cover: PublishFiles['cover'] = null) => ({
  items,
  cover,
})

const noFiles: PublishFiles = { items: [], cover: null }

function ctx(signal: AbortSignal = new AbortController().signal): StepContext {
  return {
    signal,
    saveIds: (ids) => {
      saved.push(structuredClone(ids))
      return Promise.resolve()
    },
  }
}

const posts = (path: string) => mock.calls().filter((c) => c.method === 'POST' && c.path === path)
const statusReads = () => mock.calls().filter((c) => c.params.fields === 'status_code,status')

async function failure(promise: Promise<unknown>): Promise<PublishError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof PublishError) return err
    throw err
  }
  throw new Error('expected a PublishError')
}

/** prepare → publish → verify, as the worker will chain them. */
async function goOut(t: PublishTarget, f: PublishFiles) {
  const prepared = await publisher.prepare(t, f, ctx())
  expect(prepared.outcome).toBe('done')
  const ready = { ...t, metaIds: prepared.metaIds }
  const published = await publisher.publish(ready, noFiles, ctx())
  expect(published.outcome).toBe('done')
  const out = published as Extract<StepResult, { outcome: 'done' }>
  const verified = await publisher.verify(
    { ...ready, metaIds: out.metaIds, externalPostId: out.externalPostId },
    new AbortController().signal,
  )
  return { prepared, published: out, verified }
}

describe('every type reaches a confirmed post', () => {
  test('photo: one container with the caption, then media_publish', async () => {
    const { published, verified } = await goOut(target('photo'), files([image()]))
    expect(published.externalPostId).toMatch(/^1800/)
    expect(verified).toMatchObject({
      outcome: 'confirmed',
      permalink: expect.stringContaining('instagram.com/p/') as string,
    })
    expect(posts(`/${ig}/media`)).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          image_url: image().url,
          caption: 'Pane caldo\n alle 7',
        }) as object,
      }),
    ])
    expect(posts(`/${ig}/media_publish`)).toHaveLength(1)
    // the ids are saved after every call, before the next one
    expect(saved.at(-1)).toMatchObject({ mediaId: published.externalPostId })
  })

  test('carousel: the items, the video waits for FINISHED read once a minute, then CAROUSEL', async () => {
    mock.scenario('container_in_progress', { reads: 1 })
    const t = target('carousel')
    const f = files([image(), video(), image()])
    const first = await publisher.prepare(t, f, ctx())
    expect(first).toMatchObject({ outcome: 'wait', reason: 'processing' })
    expect((first as { retryAt: Date }).retryAt.getTime()).toBe(clock.now().getTime() + 60_000)

    // within the minute nothing is read again
    const reads = statusReads().length
    clock.advance(30_000)
    const early = await publisher.prepare({ ...t, metaIds: first.metaIds }, f, ctx())
    expect(early.outcome).toBe('wait')
    expect(statusReads()).toHaveLength(reads)

    clock.advance(30_000)
    const done = await publisher.prepare({ ...t, metaIds: early.metaIds }, f, ctx())
    expect(done.outcome).toBe('done')
    const items = posts(`/${ig}/media`).filter((c) => c.params.is_carousel_item === 'true')
    expect(items.map((c) => c.params.media_type ?? 'IMAGE')).toEqual(['IMAGE', 'VIDEO', 'IMAGE'])
    expect(items.every((c) => c.params.caption === undefined)).toBe(true)
    const parent = posts(`/${ig}/media`).filter((c) => c.params.media_type === 'CAROUSEL')
    expect(parent).toHaveLength(1)
    expect(parent[0]?.params.children?.split(',')).toHaveLength(3)

    const published = await publisher.publish({ ...t, metaIds: done.metaIds }, noFiles, ctx())
    const id = (published as { externalPostId: string }).externalPostId
    const verified = await publisher.verify(
      { ...t, externalPostId: id },
      new AbortController().signal,
    )
    expect(verified.outcome).toBe('confirmed')
  })

  test('reel: REELS with share_to_feed and the cover frame', async () => {
    const { verified } = await goOut(target('reel'), files([video()], { offsetMs: 1500 }))
    expect(posts(`/${ig}/media`)[0]?.params).toMatchObject({
      media_type: 'REELS',
      video_url: video().url,
      share_to_feed: 'true',
      thumb_offset: '1500',
    })
    expect(verified).toMatchObject({
      outcome: 'confirmed',
      permalink: expect.stringContaining('/reel/') as string,
    })
  })

  test('reel with an uploaded cover, out of the feed', async () => {
    await goOut(
      target('reel', { shareToFeed: false }),
      files([video()], { url: `${mock.url}/pictures/bottega.jpg` }),
    )
    expect(posts(`/${ig}/media`)[0]?.params).toMatchObject({
      share_to_feed: 'false',
      cover_url: `${mock.url}/pictures/bottega.jpg`,
    })
  })

  test('story: STORIES without a caption', async () => {
    const { verified } = await goOut(target('story'), files([video()]))
    expect(posts(`/${ig}/media`)[0]?.params).toMatchObject({ media_type: 'STORIES' })
    expect(posts(`/${ig}/media`)[0]?.params).not.toHaveProperty('caption')
    expect(verified.outcome).toBe('confirmed')
  })
})

describe('containers', () => {
  test('a container that fails processing fails the destination', async () => {
    mock.scenario('container_error', { times: 1 })
    const err = await failure(publisher.prepare(target('reel'), files([video()]), ctx()))
    expect([err.kind, err.code]).toEqual(['permanent', 'media_rejected'])
  })

  test('a file Meta cannot download fails the destination', async () => {
    mock.scenario('media_download_failed', { times: 1 })
    const err = await failure(publisher.prepare(target('photo'), files([image()]), ctx()))
    expect([err.kind, err.code, err.platformCode]).toEqual([
      'permanent',
      'media_rejected',
      '9004/2207052',
    ])
  })

  test('after 24 hours the containers are made again; publish says to prepare again', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    clock.advance(24 * 3_600_000)
    const published = await publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx())
    expect(published.outcome).toBe('expired')
    expect(posts(`/${ig}/media_publish`)).toHaveLength(0)
    const again = await publisher.prepare(
      { ...t, metaIds: prepared.metaIds },
      files([image()]),
      ctx(),
    )
    expect(again.outcome).toBe('done')
    expect(posts(`/${ig}/media`)).toHaveLength(2)
  })

  test('a container Meta says EXPIRED: prepare makes a new one, publish says to prepare again', async () => {
    mock.scenario('container_in_progress', { reads: 5, times: 1 })
    const t = target('reel')
    const waiting = await publisher.prepare(t, files([video()]), ctx())
    mock.scenario('container_expired', { times: 1 })
    clock.advance(60_000)
    const renewed = await publisher.prepare(
      { ...t, metaIds: waiting.metaIds },
      files([video()]),
      ctx(),
    )
    expect(posts(`/${ig}/media`)).toHaveLength(2)
    expect(renewed.outcome).toBe('done')

    mock.scenario('container_expired', { times: 1 })
    const published = await publisher.publish({ ...t, metaIds: renewed.metaIds }, noFiles, ctx())
    expect(published.outcome).toBe('expired')
  })
})

test('a container already published is uncertain in prepare, never made again', async () => {
  mock.scenario('container_in_progress', { reads: 1, all: true, times: 1 })
  const t = target('photo')
  const waiting = await publisher.prepare(t, files([image()]), ctx())
  expect(waiting.outcome).toBe('wait')
  // the container finishes and someone publishes it while the destination waits
  clock.advance(60_000)
  const done = await publisher.prepare({ ...t, metaIds: waiting.metaIds }, files([image()]), ctx())
  await publisher.publish({ ...t, metaIds: done.metaIds }, noFiles, ctx())
  const stale = {
    ...(done.metaIds as { container: { id: string } }),
    container: {
      id: (done.metaIds as { container: { id: string } }).container.id,
      finished: false,
    },
  }
  clock.advance(60_000)
  const err = await failure(publisher.prepare({ ...t, metaIds: stale }, files([image()]), ctx()))
  expect(err.kind).toBe('uncertain')
  expect(posts(`/${ig}/media`)).toHaveLength(1)
})

describe('publish', () => {
  test('without quota the destination waits for the window', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    mock.scenario('quota_exhausted', { igUserId: ig })
    const result = await publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx())
    expect(result).toMatchObject({ outcome: 'wait', reason: 'quota' })
    expect((result as { retryAt: Date }).retryAt.getTime()).toBeGreaterThan(clock.now().getTime())
    expect(posts(`/${ig}/media_publish`)).toHaveLength(0)
  })

  test('a timeout after the post came out is uncertain, and the search finds it', async () => {
    const t = target('photo')
    const since = clock.now()
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    mock.scenario('publish_timeout_but_created', { delayMs: 2_000 })
    const err = await failure(
      publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx()),
    )
    expect(err.kind).toBe('uncertain')
    expect(posts(`/${ig}/media_publish`)).toHaveLength(1)

    const found = await publisher.findPublished(t, since, new AbortController().signal)
    expect(found).toMatchObject({ externalPostId: expect.stringMatching(/^1800/) as string })
    // another text, or outside the window: not ours
    const other = await publisher.findPublished(
      { ...t, caption: 'Altro testo' },
      since,
      new AbortController().signal,
    )
    expect(other).toBeNull()
    const otherType = await publisher.findPublished(
      { ...t, type: 'reel' },
      since,
      new AbortController().signal,
    )
    expect(otherType).toBeNull()
    const later = await publisher.findPublished(
      t,
      new Date(since.getTime() + 11 * 60_000),
      new AbortController().signal,
    )
    expect(later).toBeNull()
  })

  test('the search of a story looks among the stories', async () => {
    const t = target('story')
    const since = clock.now()
    await goOut(t, files([image()]))
    const found = await publisher.findPublished(t, since, new AbortController().signal)
    expect(found).not.toBeNull()
  })

  test('a destination that has its post is never published again', async () => {
    const result = await publisher.publish(
      target('photo', { externalPostId: '18000000000000009' }),
      noFiles,
      ctx(),
    )
    expect(result).toMatchObject({ outcome: 'done', externalPostId: '18000000000000009' })
    expect(mock.calls()).toHaveLength(0)
  })

  test('nothing prepared: publish asks to prepare, without calling Meta', async () => {
    const result = await publisher.publish(target('photo'), noFiles, ctx())
    expect(result.outcome).toBe('expired')
    expect(mock.calls()).toHaveLength(0)
  })

  test('a stopped worker leaves media_publish uncertain, never repeated', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    mock.scenario('timeout', { path: `/${ig}/media_publish`, delayMs: 1_000 })
    const stop = new AbortController()
    setTimeout(() => {
      stop.abort()
    }, 50)
    const err = await failure(
      publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx(stop.signal)),
    )
    expect(err.kind).toBe('uncertain')
    expect(posts(`/${ig}/media_publish`)).toHaveLength(1)
  })

  test('a server error on media_publish is uncertain, never retried by the client', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    mock.scenario('transient_error', { path: `/${ig}/media_publish` })
    const err = await failure(
      publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx()),
    )
    expect(err.kind).toBe('uncertain')
    expect(posts(`/${ig}/media_publish`)).toHaveLength(1)
  })

  test('a rate limit on media_publish is a refusal: safe to try again', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    mock.scenario('rate_limited', { path: `/${ig}/media_publish`, times: 1 })
    const err = await failure(
      publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx()),
    )
    expect(err.kind).toBe('transient')
  })

  test('publishing again a container whose answer was lost is uncertain, never a new post', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    // the first media_publish goes out, its answer never reaches the worker
    await publisher.publish({ ...t, metaIds: structuredClone(prepared.metaIds) }, noFiles, ctx())
    const err = await failure(
      publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx()),
    )
    expect(err.kind).toBe('uncertain')
    expect(posts(`/${ig}/media`)).toHaveLength(1)
    // and after 24 hours the old container still says so
    clock.advance(24 * 3_600_000)
    const late = await failure(
      publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx()),
    )
    expect(late.kind).toBe('uncertain')
  })

  test('prepare never drops the ids of a post that came out', async () => {
    const t = target('photo')
    const prepared = await publisher.prepare(t, files([image()]), ctx())
    const published = await publisher.publish({ ...t, metaIds: prepared.metaIds }, noFiles, ctx())
    clock.advance(25 * 3_600_000)
    const again = await publisher.prepare(
      { ...t, metaIds: published.metaIds },
      files([image()]),
      ctx(),
    )
    expect(again).toMatchObject({ outcome: 'done', metaIds: published.metaIds })
    expect(posts(`/${ig}/media`)).toHaveLength(1)
    const unreadable = await failure(
      publisher.prepare(
        { ...t, metaIds: { mediaId: '18000000000000001' } },
        files([image()]),
        ctx(),
      ),
    )
    expect(unreadable.kind).toBe('uncertain')
  })

  test('a rate limit carries when to try again and the load of the account', async () => {
    mock.scenario('rate_limited', { path: `/${ig}/media`, minutesToRegain: 4 })
    const err = await failure(publisher.prepare(target('photo'), files([image()]), ctx()))
    expect([err.kind, err.code, err.platformCode]).toEqual(['transient', 'rate_limited', '80002'])
    expect(err.retryAt?.getTime()).toBe(clock.now().getTime() + 4 * 60_000)
    expect(err.load).toMatchObject({ accountPercent: 100, appPercent: 100, regainMinutes: 4 })
  })
})

describe('verify', () => {
  test('a post that is no longer there is a problem', async () => {
    const result = await publisher.verify(
      target('photo', { externalPostId: '18009999999999999' }),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ outcome: 'problem', reason: 'not_found' })
  })

  test('a post of another type is a problem', async () => {
    const { published } = await goOut(target('photo'), files([image()]))
    const result = await publisher.verify(
      target('reel', { externalPostId: published.externalPostId }),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ outcome: 'problem', reason: 'wrong_type' })
  })
})

test('appsecret_proof on every call, and no token in the calls or the logs', async () => {
  mock.scenario('container_in_progress', { reads: 1 })
  const t = target('carousel')
  const f = files([image(), video()])
  const first = await publisher.prepare(t, f, ctx())
  clock.advance(60_000)
  const done = await publisher.prepare({ ...t, metaIds: first.metaIds }, f, ctx())
  await publisher.publish({ ...t, metaIds: done.metaIds }, noFiles, ctx())
  mock.scenario('error', { code: 190, subcode: 463 })
  await failure(publisher.verify({ ...t, externalPostId: '1' }, new AbortController().signal))

  const proof = createHmac('sha256', META_MOCK.app.secret).update(token).digest('hex')
  const graph = mock.calls().filter((c) => !c.path.startsWith('/pictures/'))
  expect(graph.length).toBeGreaterThan(5)
  for (const call of graph) {
    expect(call.tokenIn).toBe('header')
    expect(call.params.appsecret_proof).toBe(proof)
    expect(JSON.stringify(call.params)).not.toContain(token)
  }
  const everything = `${lines.join('\n')}${JSON.stringify(saved)}`
  for (const secret of [token, META_MOCK.app.secret, proof])
    expect(everything).not.toContain(secret)
})
