import {
  PublishError,
  type Logger,
  type PlatformPublisher,
  type PublishFiles,
  type PublishMetaIds,
  type PublishTarget,
  type StepContext,
  type StepResult,
  type VerifyContext,
  type VerifyResult,
} from '@app/application'
import type { PostType } from '@app/domain'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fixedClock } from '../../testing/index.js'
import { createMetaGraphClient } from './graph-client.js'
import { createMetaPublishers } from './publisher.js'

// Facebook Page publishing against the fake Graph API (plan 07, Task 5). No database: unit project.

let mock: MetaMock
let clock: ReturnType<typeof fixedClock>
let publisher: PlatformPublisher
let lines: string[]
let saved: PublishMetaIds[]

const page = META_MOCK.pages.withInstagram
const pageToken = META_MOCK.tokens.page(page)

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
  clock = fixedClock(new Date())
  const client = createMetaGraphClient({
    mode: 'mock',
    version: 'v25.0',
    baseUrl: mock.url,
    clock,
    logger: memoryLogger(),
    timeoutMs: 300,
    fileTimeoutMs: 300,
    retryBaseDelayMs: 1,
  })
  const ready = createMetaPublishers({ client, clock }).facebook
  if (ready === undefined) throw new Error('no Facebook publisher')
  publisher = ready
})

afterEach(async () => {
  await mock.stop()
})

function target(type: PostType, over: Partial<PublishTarget> = {}): PublishTarget {
  return {
    targetId: 'target-1',
    account: { platform: 'facebook', externalId: page, pageId: page, scopes: null },
    credentials: {
      app: { appId: META_MOCK.app.id, appSecret: META_MOCK.app.secret, version: new Date() },
      token: META_MOCK.tokens.systemUser,
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

const image = (name = 'forno') => ({
  kind: 'image' as const,
  url: `${mock.url}/pictures/${name}.jpg`,
})
const video = () => ({ kind: 'video' as const, url: `${mock.url}/pictures/forno.jpg?v=1` })
const files = (items: PublishFiles['items']): PublishFiles => ({ items, cover: null })

function ctx(signal: AbortSignal = new AbortController().signal): StepContext {
  return {
    signal,
    saveIds: (ids) => {
      saved.push(structuredClone(ids))
      return Promise.resolve()
    },
  }
}

const signal = () => new AbortController().signal
const calls = (method: string, path: string) =>
  mock.calls().filter((c) => c.method === method && c.path === path)

async function failure(promise: Promise<unknown>): Promise<PublishError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof PublishError) return err
    throw err
  }
  throw new Error('expected a PublishError')
}

type Done = Extract<StepResult, { outcome: 'done' }>

/** prepare → publish, as the worker will chain them. */
async function goOut(t: PublishTarget, f: PublishFiles) {
  const prepared = await publisher.prepare(t, f, ctx())
  expect(prepared.outcome).toBe('done')
  const ready = { ...t, metaIds: prepared.metaIds }
  const published = await publisher.publish(ready, f, ctx())
  expect(published.outcome).toBe('done')
  const out = published as Done
  return { ready: { ...ready, metaIds: out.metaIds, externalPostId: out.externalPostId }, out }
}

describe('every type reaches a confirmed post', () => {
  test('photo: one call with the url and the caption, with the Page token', async () => {
    const t = target('photo')
    const { ready, out } = await goOut(t, files([image()]))
    expect(out.externalPostId).toMatch(new RegExp(`^${page}_`))
    expect(calls('POST', `/${page}/photos`)).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          url: image().url,
          caption: 'Pane caldo\n alle 7',
        }) as object,
      }),
    ])
    // the Page token comes from the connection's token, at each step
    expect(
      mock.calls().filter((c) => c.path === `/${page}` && c.params.fields === 'access_token'),
    ).toHaveLength(2)
    expect(await publisher.verify(ready, signal())).toMatchObject({
      outcome: 'confirmed',
      permalink: expect.stringMatching(/^https:\/\/www\.facebook\.com\//) as string,
    })
  })

  test('multi-photo: unpublished photos saved one by one, then one feed post', async () => {
    const t = target('carousel')
    const { ready } = await goOut(t, files([image(), image('bottega'), image()]))
    const uploads = calls('POST', `/${page}/photos`)
    expect(uploads.map((c) => c.params.published)).toEqual(['false', 'false', 'false'])
    expect(
      saved.filter((s) => Array.isArray(s.photos)).map((s) => (s.photos as unknown[]).length),
    ).toEqual(expect.arrayContaining([1, 2, 3]))
    const [post] = calls('POST', `/${page}/feed`)
    expect(post?.params).toMatchObject({ message: 'Pane caldo\n alle 7' })
    expect(JSON.parse(post?.params['attached_media[2]'] ?? '{}')).toHaveProperty('media_fbid')
    expect((await publisher.verify(ready, signal())).outcome).toBe('confirmed')
  })

  test('reel: start, hosted upload, finish; the check waits for the processing', async () => {
    mock.scenario('video_processing', { reads: 1 })
    const t = target('reel')
    const { ready, out } = await goOut(t, files([video()]))
    expect(calls('POST', `/video-upload/${String(out.externalPostId)}`)).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ file_url: video().url }) as object,
      }),
    ])
    expect(calls('POST', `/${page}/video_reels`).map((c) => c.params)).toEqual([
      expect.objectContaining({ upload_phase: 'start' }),
      expect.objectContaining({
        upload_phase: 'finish',
        video_id: out.externalPostId,
        video_state: 'PUBLISHED',
        description: 'Pane caldo\n alle 7',
      }),
    ])
    expect((await publisher.verify(ready, signal())).outcome).toBe('pending')
    expect(await publisher.verify(ready, signal())).toMatchObject({
      outcome: 'confirmed',
      permalink: `https://www.facebook.com/reel/${String(out.externalPostId)}`,
    })
  })

  test('a reel beyond its length goes out as a plain video', async () => {
    const t = target('reel', { asVideo: true })
    const { ready } = await goOut(t, files([video()]))
    expect(calls('POST', `/${page}/video_reels`)).toHaveLength(0)
    expect(calls('POST', `/${page}/videos`)[0]?.params).toMatchObject({
      file_url: video().url,
      description: 'Pane caldo\n alle 7',
    })
    expect((await publisher.verify(ready, signal())).outcome).toBe('confirmed')
  })

  test('photo story: an unpublished photo, then photo_stories', async () => {
    const t = target('story')
    const { ready } = await goOut(t, files([image()]))
    expect(calls('POST', `/${page}/photos`)[0]?.params).toMatchObject({ published: 'false' })
    expect(calls('POST', `/${page}/photo_stories`)).toHaveLength(1)
    expect((await publisher.verify(ready, signal())).outcome).toBe('confirmed')
  })

  test('video story: the upload session of video_stories', async () => {
    const t = target('story')
    const { ready } = await goOut(t, files([video()]))
    expect(calls('POST', `/${page}/video_stories`).map((c) => c.params.upload_phase)).toEqual([
      'start',
      'finish',
    ])
    expect((await publisher.verify(ready, signal())).outcome).toBe('confirmed')
  })
})

describe('the Page token', () => {
  test('never in an address, a saved id or a log line', async () => {
    await goOut(target('carousel'), files([image(), image()]))
    for (const c of mock.calls()) expect(JSON.stringify(c.params)).not.toContain(pageToken)
    expect(JSON.stringify(saved)).not.toContain(pageToken)
    expect(lines.join('\n')).not.toContain(pageToken)
    // the Page edges answer only the Page token: every call reached them with it
    expect(calls('POST', `/${page}/feed`)).toHaveLength(1)
  })

  test('without it the destination fails: the connection has no task on the Page', async () => {
    mock.scenario('page_token_missing', { pageId: page })
    const err = await failure(publisher.publish(target('photo'), files([image()]), ctx()))
    expect(err).toMatchObject({ kind: 'permanent', code: 'permission_missing' })
  })
})

describe('prepare', () => {
  test('resumes where it stopped: a reel already started is not started again', async () => {
    const t = target('reel')
    mock.scenario('transient_error', { path: /^\/video-upload\//, times: 3 })
    const err = await failure(publisher.prepare(t, files([video()]), ctx()))
    expect(err.kind).toBe('transient')
    const last = saved.at(-1)
    expect(last).toMatchObject({ video: { uploaded: false } })
    const again = await publisher.prepare({ ...t, metaIds: last ?? null }, files([video()]), ctx())
    expect(again.outcome).toBe('done')
    expect(calls('POST', `/${page}/video_reels`)).toHaveLength(1)
  })

  test('a video Meta cannot fetch is tried again, never «a wrong file» (D-131.2)', async () => {
    mock.scenario('media_download_failed')
    const err = await failure(publisher.prepare(target('reel'), files([video()]), ctx()))
    expect(err).toMatchObject({
      kind: 'transient',
      code: 'media_unreachable',
      platformCode: '389',
    })
  })

  test('a photo and a plain video have nothing to prepare but the Page token check', async () => {
    const result = await publisher.prepare(target('photo'), files([image()]), ctx())
    expect(result.outcome).toBe('done')
    expect(mock.calls().map((c) => c.path)).toEqual([`/${page}`])
    mock.scenario('page_token_missing')
    const err = await failure(
      publisher.prepare(target('reel', { asVideo: true }), files([video()]), ctx()),
    )
    expect(err.code).toBe('permission_missing')
  })

  test('a multi-photo prepared halfway is never published with part of its photos', async () => {
    const t = target('carousel')
    const f = files([image(), image(), image()])
    // one photo of three on Meta (a prepare stopped halfway): never enough
    const ok = await publisher.prepare(t, files([image()]), ctx())
    const result = await publisher.publish({ ...t, metaIds: ok.metaIds }, f, ctx())
    expect(result.outcome).toBe('expired')
    expect(calls('POST', `/${page}/feed`)).toHaveLength(0)
  })

  test('saved ids that say the post is out are never prepared again', async () => {
    const err = await failure(
      publisher.prepare(target('photo', { metaIds: { postId: 'x' } }), files([image()]), ctx()),
    )
    expect(err.kind).toBe('uncertain')
  })
})

describe('publish', () => {
  test('a duplicate is refused for good', async () => {
    mock.scenario('duplicate_post')
    const err = await failure(publisher.publish(target('photo'), files([image()]), ctx()))
    expect(err).toMatchObject({ kind: 'permanent', code: 'duplicate', platformCode: '506' })
  })

  test('a timeout after the post came out is uncertain, and the search finds it', async () => {
    const t = target('carousel')
    const f = files([image(), image()])
    const since = clock.now()
    const prepared = await publisher.prepare(t, f, ctx())
    mock.scenario('publish_timeout_but_created', { delayMs: 2_000 })
    const err = await failure(publisher.publish({ ...t, metaIds: prepared.metaIds }, f, ctx()))
    expect(err.kind).toBe('uncertain')
    expect(calls('POST', `/${page}/feed`)).toHaveLength(1)

    const ready = { ...t, metaIds: prepared.metaIds }
    const found = await publisher.findPublished(ready, since, signal())
    expect(found?.externalPostId).toMatch(new RegExp(`^${page}_`))
    expect(
      await publisher.findPublished({ ...ready, caption: 'Altro' }, since, signal()),
    ).toBeNull()
    const later = new Date(since.getTime() + 11 * 60_000)
    expect(await publisher.findPublished(ready, later, signal())).toBeNull()
  })

  test('a server error on the call that publishes is uncertain, never repeated', async () => {
    mock.scenario('transient_error', { path: `/${page}/photos` })
    const err = await failure(publisher.publish(target('photo'), files([image()]), ctx()))
    expect(err.kind).toBe('uncertain')
    expect(calls('POST', `/${page}/photos`)).toHaveLength(1)
  })

  test('a run that stopped after the call is never published again, only searched', async () => {
    const t = target('photo')
    mock.scenario('publish_timeout_but_created', { delayMs: 2_000 })
    await failure(publisher.publish(t, files([image()]), ctx()))
    // the worker died before it marked the step: the saved ids carry the mark
    const marked = saved.at(-1) ?? null
    expect(marked).toMatchObject({ publishingAt: expect.any(String) as string, postId: null })
    const again = await failure(
      publisher.publish({ ...t, metaIds: marked }, files([image()]), ctx()),
    )
    expect(again.kind).toBe('uncertain')
    const discard = await failure(publisher.discard({ ...t, metaIds: marked }, signal()))
    expect(discard.kind).toBe('uncertain')
    expect(calls('POST', `/${page}/photos`)).toHaveLength(1)
  })

  test('«Riprova» after a search that found nothing starts a new round (review R2)', async () => {
    const t = target('carousel')
    const f = files([image(), image()])
    const prepared = await publisher.prepare(t, f, ctx())
    mock.scenario('publish_timeout_but_created', { delayMs: 2_000 })
    await failure(publisher.publish({ ...t, metaIds: prepared.metaIds }, f, ctx()))
    const marked = saved.at(-1) ?? null
    expect(marked).toMatchObject({ publishingAt: expect.any(String) as string })
    // with the mark, every preparation would be uncertain: the platform starts again
    expect(publisher.idsAfterNotFound(marked)).toBeNull()
    const again = await publisher.prepare({ ...t, metaIds: null }, f, ctx())
    expect(again.outcome).toBe('done')
    expect(again.metaIds).toMatchObject({ publishingAt: null, postId: null })
  })

  test('a refusal before acting clears the mark: the step can be tried again', async () => {
    const t = target('photo')
    mock.scenario('rate_limited', { path: `/${page}/photos`, code: 32, times: 1 })
    const err = await failure(publisher.publish(t, files([image()]), ctx()))
    expect(err).toMatchObject({ kind: 'transient', code: 'rate_limited' })
    const after = saved.at(-1) ?? null
    expect(after).toMatchObject({ publishingAt: null })
    const out = await publisher.publish({ ...t, metaIds: after }, files([image()]), ctx())
    expect(out.outcome).toBe('done')
  })

  test('a Page id that is not digits never reaches an address', async () => {
    const t = target('photo', {
      account: { platform: 'facebook', externalId: '..', pageId: '..', scopes: null },
    })
    const err = await failure(publisher.publish(t, files([image()]), ctx()))
    expect(err.kind).toBe('permanent')
    expect(mock.calls()).toHaveLength(0)
  })

  test('the search of a reel finds its own upload, whatever the text', async () => {
    const t = target('reel')
    const since = clock.now()
    const { ready } = await goOut(t, files([video()]))
    const found = await publisher.findPublished(
      { ...ready, caption: 'cambiato', externalPostId: null },
      since,
      signal(),
    )
    expect(found?.externalPostId).toBe(ready.externalPostId)
  })

  test('a round older than a day is prepared again', async () => {
    const t = target('carousel')
    const f = files([image(), image()])
    const prepared = await publisher.prepare(t, f, ctx())
    clock.advance(23 * 3_600_000)
    const result = await publisher.publish({ ...t, metaIds: prepared.metaIds }, f, ctx())
    expect(result.outcome).toBe('expired')
    expect(calls('POST', `/${page}/feed`)).toHaveLength(0)
  })

  test('published already: never twice', async () => {
    const t = target('photo')
    const { ready } = await goOut(t, files([image()]))
    const again = await publisher.publish(ready, files([image()]), ctx())
    expect(again).toMatchObject({ outcome: 'done', externalPostId: ready.externalPostId })
    expect(calls('POST', `/${page}/photos`)).toHaveLength(1)
  })
})

describe('discard', () => {
  test('the unpublished photos of a changed post are deleted', async () => {
    const t = target('carousel')
    const prepared = await publisher.prepare(t, files([image(), image()]), ctx())
    await publisher.discard({ ...t, metaIds: prepared.metaIds }, signal())
    expect(mock.calls().filter((c) => c.method === 'DELETE')).toHaveLength(2)
    // gone already: thrown away all the same
    await publisher.discard({ ...t, metaIds: prepared.metaIds }, signal())
  })

  test('a published post is never touched', async () => {
    const { ready } = await goOut(target('story'), files([image()]))
    await publisher.discard(ready, signal())
    expect(mock.calls().filter((c) => c.method === 'DELETE')).toHaveLength(0)
  })
})

describe('stories', () => {
  test('the uncertain search finds a story by type and time; verify by its id', async () => {
    const t = target('story')
    const since = clock.now()
    const { ready } = await goOut(t, files([image()]))
    const found = await publisher.findPublished({ ...ready, externalPostId: null }, since, signal())
    expect(found?.externalPostId).toBe(ready.externalPostId)
    const gone = await publisher.verify({ ...ready, externalPostId: '7300999' }, signal())
    expect(gone).toMatchObject({ outcome: 'problem', reason: 'not_found' })
  })

  test('the search leaves out the stories of other destinations; two that fit are not sure', async () => {
    const t = target('story')
    const since = clock.now()
    const first = await goOut(t, files([image()]))
    const second = await goOut({ ...t, targetId: 'target-2' }, files([image()]))
    const looking = { ...t, metaIds: second.ready.metaIds }
    // review R3: either story may be this one's
    expect(await publisher.findPublished(looking, since, signal())).toBeNull()
    const found = await publisher.findPublished(looking, since, signal(), [
      first.out.externalPostId ?? '',
    ])
    expect(found?.externalPostId).toBe(second.out.externalPostId)
  })

  test('a video story session is thrown away by discard; a reel round expires after a day', async () => {
    const t = target('story')
    const prepared = await publisher.prepare(t, files([video()]), ctx())
    await publisher.discard({ ...t, metaIds: prepared.metaIds }, signal())
    expect(mock.calls().filter((c) => c.method === 'DELETE')).toHaveLength(1)

    const reel = target('reel')
    const round = await publisher.prepare(reel, files([video()]), ctx())
    clock.advance(23 * 3_600_000)
    const late = await publisher.publish(
      { ...reel, metaIds: round.metaIds },
      files([video()]),
      ctx(),
    )
    expect(late.outcome).toBe('expired')
  })
})

describe('verify', () => {
  test('a reel that failed processing is a problem', async () => {
    mock.scenario('video_error')
    const { ready } = await goOut(target('reel'), files([video()]))
    expect(await publisher.verify(ready, signal())).toMatchObject({
      outcome: 'problem',
      reason: 'failed',
    })
  })

  test('a post that is not there is a problem', async () => {
    const result = await publisher.verify(
      target('photo', { externalPostId: `${page}_7100999` }),
      signal(),
    )
    expect(result).toMatchObject({ outcome: 'problem', reason: 'not_found' })
  })
})

describe("the reel's cover (D-120.9), sent by the verification (review R5)", () => {
  const scopes = ['pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content']
  const jpeg = { bytes: new Uint8Array(64), contentType: 'image/jpeg' }
  const withCover = (): PublishFiles => ({
    items: [video()],
    cover: { url: `${mock.url}/pictures/bottega.jpg`, read: () => Promise.resolve(jpeg) },
  })
  const withScopes = (s: string[] | null) =>
    target('reel', { account: { platform: 'facebook', externalId: page, pageId: page, scopes: s } })
  const round = (over: Partial<VerifyContext> = {}): VerifyContext & { reads: () => number } => {
    let reads = 0
    return {
      readCover: () => {
        reads += 1
        return Promise.resolve(jpeg)
      },
      lastRound: false,
      ...over,
      reads: () => reads,
    }
  }
  const thumbnails = () => mock.calls().filter((c) => c.path.endsWith('/thumbnails'))
  /** The destination as the worker hands it to the next round, with the ids it saved. */
  const after = (t: PublishTarget, r: VerifyResult) => ({ ...t, metaIds: r.metaIds ?? t.metaIds })

  test('the publish step sends nothing: the cover waits for the verification', async () => {
    const { out } = await goOut(withScopes(scopes), withCover())
    expect(out.metaIds).toMatchObject({ cover: 'pending' })
    expect(thumbnails()).toHaveLength(0)
  })

  test('the reel ready: sent once, preferred, with the Page token, and saved as done', async () => {
    const { ready } = await goOut(withScopes(scopes), withCover())
    const ctx = round()
    const result = await publisher.verify(ready, signal(), ctx)
    expect(result).toMatchObject({ outcome: 'confirmed', metaIds: { cover: 'done' } })
    const sent = calls('POST', `/${String(ready.externalPostId)}/thumbnails`)
    expect(sent.map((c) => c.params)).toEqual([
      expect.objectContaining({ is_preferred: 'true', source: 'file:image/jpeg:64' }),
    ])
    expect(sent[0]?.tokenIn).toBeDefined()
    // done: a later check reads only
    const again = await publisher.verify(after(ready, result), signal(), ctx)
    expect(again.outcome).toBe('confirmed')
    expect(thumbnails()).toHaveLength(1)
    expect(ctx.reads()).toBe(1)
  })

  test('while Meta processes the reel: no call and no read, then sent once it is ready', async () => {
    mock.scenario('video_processing', { reads: 1 })
    const { ready } = await goOut(withScopes(scopes), withCover())
    const ctx = round()
    const first = await publisher.verify(ready, signal(), ctx)
    expect(first.outcome).toBe('pending')
    expect(thumbnails()).toHaveLength(0)
    expect(ctx.reads()).toBe(0)
    const second = await publisher.verify(after(ready, first), signal(), ctx)
    expect(second).toMatchObject({ outcome: 'confirmed', metaIds: { cover: 'done' } })
    expect(thumbnails()).toHaveLength(1)
  })

  test('refused once: one more try at the next round, then failed with the reel confirmed', async () => {
    mock.scenario('error', { path: /\/thumbnails$/, code: 100, status: 400 })
    const { ready } = await goOut(withScopes(scopes), withCover())
    const first = await publisher.verify(ready, signal(), round())
    expect(first).toMatchObject({ outcome: 'pending', metaIds: { cover: 'pending' } })
    const second = await publisher.verify(after(ready, first), signal(), round())
    expect(second).toMatchObject({ outcome: 'confirmed', metaIds: { cover: 'failed' } })
    expect(thumbnails()).toHaveLength(2)
  })

  test('held only for its cover: an error or a gone post at the last round never undoes the reel', async () => {
    mock.scenario('error', { path: /\/thumbnails$/, code: 100, status: 400 })
    const { ready } = await goOut(withScopes(scopes), withCover())
    const first = await publisher.verify(ready, signal(), round())
    expect(first.outcome).toBe('pending')
    const held = after(ready, first)
    mock.scenario('default')
    // Meta does not answer at the last round: the reel was seen ready, it is confirmed
    mock.scenario('error', { code: 2, status: 500 })
    const result = await publisher.verify(held, signal(), round({ lastRound: true }))
    expect(result).toMatchObject({
      outcome: 'confirmed',
      permalink: expect.stringContaining('/reel/') as string,
      metaIds: { cover: 'failed' },
    })
    mock.scenario('default')
    // not the last round: an error is a round without an answer, as for any post
    mock.scenario('error', { code: 2, status: 500 })
    await expect(publisher.verify(held, signal(), round())).rejects.toBeInstanceOf(PublishError)
  })

  test('a reel Meta no longer has: a problem, and the cover is not left waiting', async () => {
    const { ready } = await goOut(withScopes(scopes), withCover())
    mock.scenario('asset_removed', { id: ready.externalPostId ?? '' })
    expect(await publisher.verify(ready, signal(), round())).toMatchObject({
      outcome: 'problem',
      reason: 'not_found',
      metaIds: { cover: 'failed' },
    })
  })

  test('refused at the last round: failed at once, the reel confirmed', async () => {
    mock.scenario('error', { path: /\/thumbnails$/, code: 100, status: 400 })
    const { ready } = await goOut(withScopes(scopes), withCover())
    const result = await publisher.verify(ready, signal(), round({ lastRound: true }))
    expect(result).toMatchObject({ outcome: 'confirmed', metaIds: { cover: 'failed' } })
  })

  test('still processing at the last round: the cover is failed, never left waiting', async () => {
    mock.scenario('video_processing', { reads: 5 })
    const { ready } = await goOut(withScopes(scopes), withCover())
    const result = await publisher.verify(ready, signal(), round({ lastRound: true }))
    expect(result).toMatchObject({ outcome: 'pending', metaIds: { cover: 'failed' } })
    expect(thumbnails()).toHaveLength(0)
  })

  test('a permission taken away or the image gone: settled at once; a failed read: tried again', async () => {
    mock.scenario('permission_missing', { path: /\/thumbnails$/, code: 200 })
    const denied = await goOut(withScopes(scopes), withCover())
    expect(await publisher.verify(denied.ready, signal(), round())).toMatchObject({
      outcome: 'confirmed',
      metaIds: { cover: 'no_permission' },
    })

    mock.scenario('default')
    const gone = await goOut(withScopes(scopes), withCover())
    const result = await publisher.verify(
      gone.ready,
      signal(),
      round({ readCover: () => Promise.resolve(null) }),
    )
    expect(result).toMatchObject({ outcome: 'confirmed', metaIds: { cover: 'failed' } })

    const unreachable = await goOut(withScopes(scopes), withCover())
    const later = await publisher.verify(
      unreachable.ready,
      signal(),
      round({ readCover: () => Promise.reject(new Error('database out of reach')) }),
    )
    expect(later).toMatchObject({ outcome: 'pending', metaIds: { cover: 'pending' } })
  })

  test('without the permissions: no_permission at the publish step, never a call', async () => {
    for (const s of [null, ['pages_manage_posts', 'pages_manage_engagement']]) {
      mock.scenario('default')
      const { ready, out } = await goOut(withScopes(s), withCover())
      expect(out.metaIds).toMatchObject({ cover: 'no_permission' })
      const ctx = round()
      await publisher.verify(ready, signal(), ctx)
      expect(ctx.reads()).toBe(0)
    }
    expect(thumbnails()).toHaveLength(0)
  })

  test('the uncertain search verifies without a round: the cover keeps waiting', async () => {
    const { ready } = await goOut(withScopes(scopes), withCover())
    const result = await publisher.verify(ready, signal())
    expect(result.outcome).toBe('confirmed')
    expect(result.metaIds).toBeUndefined()
    expect(thumbnails()).toHaveLength(0)
  })

  test('a reel without a cover, or one out as a video, sends none', async () => {
    const { ready, out } = await goOut(withScopes(scopes), files([video()]))
    expect(out.metaIds).toMatchObject({ cover: null })
    await publisher.verify(ready, signal(), round())
    const asVideo = await goOut(
      target('reel', {
        asVideo: true,
        account: { platform: 'facebook', externalId: page, pageId: page, scopes },
      }),
      withCover(),
    )
    await publisher.verify(asVideo.ready, signal(), round())
    expect(thumbnails()).toHaveLength(0)
  })
})
