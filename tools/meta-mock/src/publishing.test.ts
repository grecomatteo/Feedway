import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { META_MOCK, startMetaMock, type MetaMock } from './index.ts'

// The Instagram publishing calls of the fake Graph API (plan 07, Task 4).

let mock: MetaMock
const token = META_MOCK.tokens.systemUser
const ig = META_MOCK.instagram.ofPage

beforeEach(async () => {
  mock = await startMetaMock()
})

afterEach(async () => {
  await mock.stop()
})

interface Answer {
  id?: string
  status_code?: string
  data?: Record<string, unknown>[]
  error?: { code: number; error_subcode?: number }
}

async function call(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}) {
  const proof = createHmac('sha256', META_MOCK.app.secret).update(token).digest('hex')
  const url = new URL(`${mock.url}/v25.0${path}`)
  url.searchParams.set('appsecret_proof', proof)
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } }
  if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  else init.body = new URLSearchParams(params)
  const res = await fetch(url, init)
  return { status: res.status, body: (await res.json()) as Answer }
}

const picture = () => `${mock.url}/pictures/forno.jpg`

test('a photo goes from container to published media, and the quota goes down', async () => {
  const before = await call('GET', `/${ig}/content_publishing_limit`, {
    fields: 'quota_usage,config',
  })
  const created = await call('POST', `/${ig}/media`, { image_url: picture(), caption: 'Pane' })
  expect(created.status).toBe(200)
  const status = await call('GET', `/${created.body.id ?? ''}`, { fields: 'status_code' })
  expect(status.body.status_code).toBe('FINISHED')
  const published = await call('POST', `/${ig}/media_publish`, {
    creation_id: created.body.id ?? '',
  })
  const mediaId = published.body.id ?? ''
  expect(mediaId).toMatch(/^1800/)
  const item = await call('GET', `/${mediaId}`, { fields: 'id,permalink,media_product_type' })
  expect(item.body).toMatchObject({ id: mediaId, media_product_type: 'FEED', caption: 'Pane' })
  const list = await call('GET', `/${ig}/media`, { fields: 'id,caption,timestamp' })
  expect(list.body.data?.map((m) => m.id)).toEqual([mediaId])
  const after = await call('GET', `/${ig}/content_publishing_limit`, {
    fields: 'quota_usage,config',
  })
  expect(after.body.data?.[0]?.quota_usage).toBe(Number(before.body.data?.[0]?.quota_usage) + 1)
  // a container publishes once
  const again = await call('POST', `/${ig}/media_publish`, { creation_id: created.body.id ?? '' })
  expect(again.body.error).toMatchObject({ code: 24, error_subcode: 2207008 })
})

test('a video stays in progress for the scenario reads, and media_publish refuses it meanwhile', async () => {
  mock.scenario('container_in_progress', { reads: 2 })
  const created = await call('POST', `/${ig}/media`, {
    media_type: 'REELS',
    video_url: picture(),
    caption: 'Reel',
  })
  const id = created.body.id ?? ''
  const early = await call('POST', `/${ig}/media_publish`, { creation_id: id })
  expect(early.body.error).toMatchObject({ code: 9007, error_subcode: 2207027 })
  const reads = []
  for (let i = 0; i < 3; i++)
    reads.push((await call('GET', `/${id}`, { fields: 'status_code' })).body.status_code)
  expect(reads).toEqual(['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'])
})

test('a carousel needs finished children and takes them by id', async () => {
  const children = []
  for (let i = 0; i < 2; i++)
    children.push(
      (await call('POST', `/${ig}/media`, { image_url: picture(), is_carousel_item: 'true' })).body
        .id ?? '',
    )
  const one = await call('POST', `/${ig}/media`, {
    media_type: 'CAROUSEL',
    children: children[0] ?? '',
  })
  expect(one.body.error).toMatchObject({ code: 100, error_subcode: 2207028 })
  const parent = await call('POST', `/${ig}/media`, {
    media_type: 'CAROUSEL',
    children: children.join(','),
    caption: 'Tre',
  })
  const published = await call('POST', `/${ig}/media_publish`, {
    creation_id: parent.body.id ?? '',
  })
  const item = await call('GET', `/${published.body.id ?? ''}`, { fields: 'media_type' })
  expect(item.body).toMatchObject({ media_type: 'CAROUSEL_ALBUM' })
})

test('download failures, errors and expiry answer as Meta documents them', async () => {
  mock.scenario('media_download_failed', { times: 1 })
  const image = await call('POST', `/${ig}/media`, { image_url: picture() })
  expect(image.body.error).toMatchObject({ code: 9004, error_subcode: 2207052 })
  const unreachable = await call('POST', `/${ig}/media`, {
    image_url: `${mock.url}/pictures/missing.jpg`,
  })
  expect(unreachable.body.error).toMatchObject({ code: 9004 })

  mock.scenario('container_error', { times: 1 })
  const video = await call('POST', `/${ig}/media`, { media_type: 'REELS', video_url: picture() })
  const status = await call('GET', `/${video.body.id ?? ''}`, { fields: 'status_code' })
  expect(status.body.status_code).toBe('ERROR')

  const photo = await call('POST', `/${ig}/media`, { image_url: picture() })
  mock.scenario('container_expired')
  const expired = await call('POST', `/${ig}/media_publish`, { creation_id: photo.body.id ?? '' })
  expect(expired.body.error).toMatchObject({ code: -2, error_subcode: 2207020 })
})

test('without quota media_publish answers 9/2207042', async () => {
  mock.scenario('quota_exhausted', { igUserId: ig })
  const photo = await call('POST', `/${ig}/media`, { image_url: picture() })
  const refused = await call('POST', `/${ig}/media_publish`, { creation_id: photo.body.id ?? '' })
  expect(refused.body.error).toMatchObject({ code: 9, error_subcode: 2207042 })
})

test('stories are listed apart, and the containers of another token stay hidden', async () => {
  const story = await call('POST', `/${ig}/media`, { media_type: 'STORIES', image_url: picture() })
  const published = await call('POST', `/${ig}/media_publish`, { creation_id: story.body.id ?? '' })
  const stories = await call('GET', `/${ig}/stories`, { fields: 'id,media_product_type' })
  expect(stories.body.data).toEqual([
    expect.objectContaining({ id: published.body.id, media_product_type: 'STORY' }),
  ])
  expect((await call('GET', `/${ig}/media`)).body.data).toEqual([])

  const other = META_MOCK.tokens.businessLogin
  const proof = createHmac('sha256', META_MOCK.app.secret).update(other).digest('hex')
  const res = await fetch(`${mock.url}/v25.0/${story.body.id ?? ''}?appsecret_proof=${proof}`, {
    headers: { authorization: `Bearer ${other}` },
  })
  expect(((await res.json()) as Answer).error).toMatchObject({ code: 100 })
})
