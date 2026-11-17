import { expect, test } from 'vitest'
import { photo, video } from '../../../rules/cases.js'
import type { DraftMedia, PlatformView, PostType } from '../../../rules/types.js'
import { FACEBOOK_RULES } from './facebook.js'

// The edges of Facebook's limits that the cases of §9.2 (rules/cases.ts) do not cross.

const view = (type: PostType, media: DraftMedia[], caption = ''): PlatformView => ({
  platform: 'facebook',
  type,
  media: media.map((m, index) => ({ index, media: m })),
  caption,
  cover: undefined,
  shareToFeed: true,
  format: FACEBOOK_RULES.format(type, media) ?? '',
})
const codes = (v: PlatformView) => FACEBOOK_RULES.checkPost(v).map((f) => f.code)

test('63.206 characters pass, 63.207 do not (D-47)', () => {
  expect(codes(view('photo', [photo()], 'a'.repeat(63_206)))).toEqual([])
  expect(codes(view('photo', [photo()], 'a'.repeat(63_207)))).toEqual(['caption_too_long'])
})

test('10 photos pass, 11 are a warning (D-48)', () => {
  const photos = (n: number) => Array.from({ length: n }, () => photo())
  expect(codes(view('carousel', photos(10)))).toEqual([])
  expect(codes(view('carousel', photos(11)))).toEqual(['facebook_too_many_photos'])
})

test('a reel of exactly 540×960 is not low', () => {
  expect(codes(view('reel', [video(10_000, { width: 540, height: 960 })]))).toEqual([])
  expect(codes(view('reel', [video(10_000, { width: 538, height: 956 })]))).toEqual([
    'reel_resolution_low_for_facebook',
  ])
})

test('a reel over 15 minutes is blocked, not sent to Facebook as a video', () => {
  expect(codes(view('reel', [video(901_000)]))).toEqual(['reel_too_long'])
})

test('a carousel of videos only can go out only without Facebook', () => {
  expect(codes(view('carousel', [video(10_000), video(10_000)]))).toEqual([
    'carousel_videos_with_facebook',
  ])
})

test('a carousel left with one photo is a photo post', () => {
  expect(FACEBOOK_RULES.format('carousel', [photo()])).toBe('photo')
})

test('the 30 reels of a day count only for reels', () => {
  const history = {
    recentFingerprints: new Map(),
    reelsLast24h: new Map([['p', 30]]),
    scheduledNear: new Map(),
  }
  const account = {
    id: 'p',
    platform: 'facebook' as const,
    active: true,
    health: 'ok' as const,
    inWorkspace: true,
    quota: null,
  }
  expect(
    FACEBOOK_RULES.checkAccount(view('photo', [photo()]), account, history, new Date()),
  ).toEqual([])
  expect(
    FACEBOOK_RULES.checkAccount(view('reel', [video(10_000)]), account, history, new Date()).map(
      (f) => f.code,
    ),
  ).toEqual(['facebook_reels_limit'])
})
