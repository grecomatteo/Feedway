import { describe, expect, test } from 'vitest'
import type { MetaAppCredentials } from '@app/application'
import { MetaError } from './errors.js'
import type { MetaGridMedia } from './graph-client.js'
import { gridMediaOf, listMetaGrid } from './grid.js'

// Instagram's grid (plan 09 Task 12): what a media becomes, and Meta's errors in two words.

const CREDENTIALS = {
  app: { appId: '1', appSecret: 'segreto' } satisfies MetaAppCredentials,
  token: 't',
}
const ACCOUNT = { platform: 'instagram' as const, externalId: '6000000000000003' }
const USAGE = {
  app: { callCount: 12, totalCputime: 3, totalTime: 5 },
  business: [
    {
      businessId: '6000000000000003',
      type: 'instagram',
      callCount: 40,
      totalCputime: 2,
      totalTime: 7,
      estimatedTimeToRegainAccessMinutes: 0,
    },
  ],
}

const media = (over: Partial<MetaGridMedia>): MetaGridMedia => ({
  id: '1790000000000001',
  mediaType: 'IMAGE',
  mediaProductType: 'FEED',
  mediaUrl: 'https://scontent.cdninstagram.com/p.jpg',
  thumbnailUrl: null,
  timestamp: new Date('2026-11-18T08:00:00Z'),
  permalink: 'https://www.instagram.com/p/x/',
  ...over,
})

const clientOf = (answer: () => Promise<MetaGridMedia[]>) => {
  const asked: { igUserId: string; limit: number }[] = []
  return {
    asked,
    client: {
      async listInstagramGridMedia(_c: unknown, igUserId: string, limit: number) {
        asked.push({ igUserId, limit })
        return { data: await answer(), usage: USAGE }
      },
    },
  }
}

describe('a media of the grid', () => {
  test('an image and a carousel show their picture, a video its cover', () => {
    expect(gridMediaOf(media({}))).toMatchObject({ kind: 'image', reel: false })
    expect(gridMediaOf(media({ mediaType: 'CAROUSEL_ALBUM' })).pictureUrl).toBe(
      'https://scontent.cdninstagram.com/p.jpg',
    )
    const reel = gridMediaOf(
      media({
        mediaType: 'VIDEO',
        mediaProductType: 'REELS',
        mediaUrl: 'https://video.cdninstagram.com/v.mp4',
        thumbnailUrl: 'https://scontent.cdninstagram.com/cover.jpg',
      }),
    )
    expect(reel).toMatchObject({
      kind: 'video',
      reel: true,
      pictureUrl: 'https://scontent.cdninstagram.com/cover.jpg',
    })
    // a video without its cover has no picture: its file is never one
    expect(gridMediaOf(media({ mediaType: 'VIDEO', thumbnailUrl: null })).pictureUrl).toBeNull()
  })
})

describe('the listing', () => {
  test('the latest of the feed, without stories, with the usage Meta said', async () => {
    const { client, asked } = clientOf(() =>
      Promise.resolve([media({}), media({ id: '1790000000000002', mediaProductType: 'STORY' })]),
    )
    const listing = await listMetaGrid(client, CREDENTIALS, ACCOUNT, 30)
    expect(asked).toEqual([{ igUserId: ACCOUNT.externalId, limit: 30 }])
    expect(listing).toMatchObject({
      ok: true,
      media: [{ externalId: '1790000000000001' }],
      load: { accountPercent: 40, appPercent: 12, regainMinutes: 0 },
    })
  })

  test('a refused token is «rejected», anything that may pass «unavailable»', async () => {
    const failing = (error: MetaError) => clientOf(() => Promise.reject(error)).client
    expect(
      await listMetaGrid(
        failing(new MetaError({ kind: 'permanent', reason: 'token_invalid' })),
        CREDENTIALS,
        ACCOUNT,
        30,
      ),
    ).toEqual({ ok: false, reason: 'rejected', load: null })
    expect(
      await listMetaGrid(
        failing(new MetaError({ kind: 'transient', reason: 'rate_limited', usage: USAGE })),
        CREDENTIALS,
        ACCOUNT,
        30,
      ),
    ).toMatchObject({ ok: false, reason: 'unavailable', load: { accountPercent: 40 } })
    // a bug is not an answer of Meta's
    await expect(
      listMetaGrid(
        clientOf(() => Promise.reject(new TypeError('x'))).client,
        CREDENTIALS,
        ACCOUNT,
        30,
      ),
    ).rejects.toThrow(TypeError)
  })

  test('a Page has no grid: nothing is asked', async () => {
    const { client, asked } = clientOf(() => Promise.resolve([media({})]))
    const listing = await listMetaGrid(
      client,
      CREDENTIALS,
      { platform: 'facebook', externalId: '5000000000000001' },
      30,
    )
    expect(listing).toEqual({ ok: true, media: [], load: null })
    expect(asked).toEqual([])
  })
})
