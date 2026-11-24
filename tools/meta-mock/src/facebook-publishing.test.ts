import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { META_MOCK, startMetaMock, type MetaMock } from './index.ts'

// The Facebook publishing calls of the fake Graph API (plan 07, Task 5).

let mock: MetaMock
const page = META_MOCK.pages.withInstagram
const pageToken = META_MOCK.tokens.page(page)

beforeEach(async () => {
  mock = await startMetaMock()
})

afterEach(async () => {
  await mock.stop()
})

type Answer = Record<string, unknown> & {
  data?: Record<string, unknown>[]
  error?: { code: number; error_subcode?: number }
}

const proofOf = (token: string) =>
  createHmac('sha256', META_MOCK.app.secret).update(token).digest('hex')

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string> = {},
  token: string = pageToken,
) {
  const url = new URL(`${mock.url}/v25.0${path}`)
  url.searchParams.set('appsecret_proof', proofOf(token))
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } }
  if (method === 'POST') init.body = new URLSearchParams(params)
  else for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, init)
  return { status: res.status, body: (await res.json()) as Answer }
}

async function upload(videoId: string, fileUrl: string) {
  const url = new URL(`${mock.url}/video-upload/v25.0/${videoId}`)
  url.searchParams.set('appsecret_proof', proofOf(pageToken))
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `OAuth ${pageToken}`, file_url: fileUrl },
  })
  return { status: res.status, body: (await res.json()) as Answer }
}

const picture = () => `${mock.url}/pictures/forno.jpg`

test('the system user reads the Page token; without it the scenario leaves it out', async () => {
  const read = await call(
    'GET',
    `/${page}`,
    { fields: 'access_token' },
    META_MOCK.tokens.systemUser,
  )
  expect(read.body).toEqual({ id: page, access_token: pageToken })
  mock.scenario('page_token_missing', { pageId: page })
  const missing = await call(
    'GET',
    `/${page}`,
    { fields: 'access_token' },
    META_MOCK.tokens.systemUser,
  )
  expect(missing.body).toEqual({ id: page })
})

test('the Page edges want the Page token, not the system user one', async () => {
  const refused = await call(
    'POST',
    `/${page}/photos`,
    { url: picture() },
    META_MOCK.tokens.systemUser,
  )
  expect(refused.body.error?.code).toBe(200)
})

test('a photo is published with its caption and read back as a post', async () => {
  const made = await call('POST', `/${page}/photos`, { url: picture(), caption: 'Pane' })
  expect(made.body).toMatchObject({
    id: expect.any(String) as string,
    post_id: expect.stringContaining(`${page}_`) as string,
  })
  const post = await call('GET', `/${String(made.body.post_id)}`, {
    fields: 'is_published,permalink_url',
  })
  expect(post.body).toMatchObject({
    is_published: true,
    permalink_url: expect.stringContaining('facebook.com') as string,
  })
  const list = await call('GET', `/${page}/published_posts`, { fields: 'id,message' })
  expect(list.body.data).toEqual([
    expect.objectContaining({ id: made.body.post_id, message: 'Pane' }),
  ])
})

test('multi-photo: unpublished photos, then one feed post; a photo is used once', async () => {
  const a = await call('POST', `/${page}/photos`, { url: picture(), published: 'false' })
  const b = await call('POST', `/${page}/photos`, { url: picture(), published: 'false' })
  expect(a.body.post_id).toBeUndefined()
  const media = (id: unknown) => JSON.stringify({ media_fbid: id })
  const post = await call('POST', `/${page}/feed`, {
    message: 'Due foto',
    'attached_media[0]': media(a.body.id),
    'attached_media[1]': media(b.body.id),
  })
  expect(String(post.body.id)).toMatch(new RegExp(`^${page}_`))
  const again = await call('POST', `/${page}/feed`, { 'attached_media[0]': media(a.body.id) })
  expect(again.body.error?.code).toBe(100)
})

test('reel: start, hosted upload, finish; processing shows in the status', async () => {
  mock.scenario('video_processing', { reads: 1 })
  const start = await call('POST', `/${page}/video_reels`, { upload_phase: 'start' })
  const videoId = String(start.body.video_id)
  expect(start.body.upload_url).toBe(`${mock.url}/video-upload/v25.0/${videoId}`)
  expect((await upload(videoId, picture())).body).toEqual({ success: true })
  const finish = await call('POST', `/${page}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: 'Il reel',
  })
  // a post id of its own beside the video's, as on real Meta
  expect(finish.body).toMatchObject({ success: true })
  expect(typeof (finish.body as { post_id?: unknown }).post_id).toBe('string')
  const first = await call('GET', `/${videoId}`, { fields: 'status,permalink_url' })
  expect(first.body).toMatchObject({ status: { video_status: 'processing' } })
  const second = await call('GET', `/${videoId}`, { fields: 'status,permalink_url' })
  expect(second.body).toMatchObject({
    status: { video_status: 'ready', publishing_phase: { publish_status: 'published' } },
    permalink_url: `/reel/${videoId}`,
  })
  const reels = await call('GET', `/${page}/video_reels`, { fields: 'id,description' })
  expect(reels.body.data?.map((r) => r.id)).toEqual([videoId])
})

test('a video that does not download answers 389', async () => {
  mock.scenario('media_download_failed')
  const made = await call('POST', `/${page}/videos`, { file_url: picture(), description: 'V' })
  expect(made.body.error?.code).toBe(389)
})

test('stories: photo from an unpublished photo, video by session', async () => {
  const photo = await call('POST', `/${page}/photos`, { url: picture(), published: 'false' })
  const story = await call('POST', `/${page}/photo_stories`, { photo_id: String(photo.body.id) })
  expect(story.body).toMatchObject({ success: true, post_id: expect.any(String) as string })
  const start = await call('POST', `/${page}/video_stories`, { upload_phase: 'start' })
  await upload(String(start.body.video_id), picture())
  const video = await call('POST', `/${page}/video_stories`, {
    upload_phase: 'finish',
    video_id: String(start.body.video_id),
  })
  expect(video.body).toMatchObject({ success: true, post_id: expect.any(String) as string })
  const list = await call('GET', `/${page}/stories`)
  expect(list.body.data?.map((s) => s.media_type)).toEqual(['video', 'photo'])
})

test('an unpublished photo is deleted; a published post is not', async () => {
  const photo = await call('POST', `/${page}/photos`, { url: picture(), published: 'false' })
  expect((await call('DELETE', `/${String(photo.body.id)}`)).body).toEqual({ success: true })
  const out = await call('POST', `/${page}/photos`, { url: picture() })
  expect((await call('DELETE', `/${String(out.body.id)}`)).body.error?.code).toBe(100)
})

test('a duplicate answers 506', async () => {
  mock.scenario('duplicate_post')
  const made = await call('POST', `/${page}/photos`, { url: picture(), caption: 'Pane' })
  expect(made.body.error?.code).toBe(506)
})

test("a reel's cover: an image as the `source` file, preferred, with the Page token", async () => {
  const start = await call('POST', `/${page}/video_reels`, { upload_phase: 'start' })
  const videoId = String(start.body.video_id)
  await upload(videoId, picture())
  const cover = async (form: FormData, token = pageToken) => {
    const url = new URL(`${mock.url}/v25.0/${videoId}/thumbnails`)
    url.searchParams.set('appsecret_proof', proofOf(token))
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })
    return (await res.json()) as Answer
  }
  const form = new FormData()
  form.set('is_preferred', 'true')
  form.set('source', new Blob([new Uint8Array(42)], { type: 'image/jpeg' }), 'cover.jpg')
  // not before the reel is out
  expect((await cover(form)).error?.code).toBe(100)
  await call('POST', `/${page}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
  })
  expect(await cover(form)).toEqual({ success: true })
  expect(mock.calls().at(-1)?.params).toMatchObject({
    is_preferred: 'true',
    source: 'file:image/jpeg:42',
  })
  expect((await cover(form, META_MOCK.tokens.systemUser)).error?.code).toBe(200)
  const noFile = new FormData()
  noFile.set('is_preferred', 'true')
  expect((await cover(noFile)).error?.code).toBe(100)
})

test("a reel's cover is refused while Meta still processes the reel (R5)", async () => {
  mock.scenario('video_processing', { reads: 1 })
  const start = await call('POST', `/${page}/video_reels`, { upload_phase: 'start' })
  const videoId = String(start.body.video_id)
  await upload(videoId, picture())
  await call('POST', `/${page}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
  })
  const send = async () => {
    const url = new URL(`${mock.url}/v25.0/${videoId}/thumbnails`)
    url.searchParams.set('appsecret_proof', proofOf(pageToken))
    const form = new FormData()
    form.set('is_preferred', 'true')
    form.set('source', new Blob([new Uint8Array(8)], { type: 'image/jpeg' }), 'cover.jpg')
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${pageToken}` },
      body: form,
    })
    return (await res.json()) as Answer
  }
  expect((await send()).error?.code).toBe(100)
  // the read of the status counts the processing down: then it is ready
  await call('GET', `/${videoId}`, { fields: 'status' })
  expect(await send()).toEqual({ success: true })
})

test('permissions_added: the cover permissions join debug_token', async () => {
  const token = META_MOCK.tokens.systemUser
  const scopes = async () => {
    const debug = new URL(`${mock.url}/v25.0/debug_token`)
    debug.search = new URLSearchParams({
      input_token: token,
      access_token: `${META_MOCK.app.id}|${META_MOCK.app.secret}`,
    }).toString()
    return ((await (await fetch(debug)).json()) as { data: { scopes: string[] } }).data.scopes
  }
  expect(await scopes()).not.toContain('pages_manage_engagement')
  mock.scenario('permissions_added')
  expect(await scopes()).toEqual(
    expect.arrayContaining(['pages_manage_engagement', 'pages_read_user_content']),
  )
})
