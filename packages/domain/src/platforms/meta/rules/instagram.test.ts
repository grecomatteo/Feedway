import { expect, test } from 'vitest'
import { photo, ruleAccount, video } from '../../../rules/cases.js'
import type { DraftMedia, PlatformView, PostType } from '../../../rules/types.js'
import { INSTAGRAM_RULES } from './instagram.js'

// The edges of Instagram's limits that the cases of §9.2 (rules/cases.ts) do not cross.

const view = (type: PostType, media: DraftMedia[], caption = ''): PlatformView => ({
  platform: 'instagram',
  type,
  media: media.map((m, index) => ({ index, media: m })),
  caption,
  cover: undefined,
  shareToFeed: true,
  format: INSTAGRAM_RULES.format(type, media) ?? '',
})
const CHECKED_AT = new Date('2026-11-17T10:00:00Z')
const NO_HISTORY = {
  recentFingerprints: new Map(),
  reelsLast24h: new Map(),
  scheduledNear: new Map(),
}
const codes = (v: PlatformView) => INSTAGRAM_RULES.checkPost(v).map((f) => f.code)

test('20 mentions pass, 21 do not', () => {
  const mentions = (n: number) => Array.from({ length: n }, (_, i) => `@u${String(i)}`).join(' ')
  expect(codes(view('photo', [photo()], mentions(20)))).toEqual([])
  expect(codes(view('photo', [photo()], mentions(21)))).toEqual(['too_many_mentions'])
})

test('a story counts no caption', () => {
  expect(codes(view('story', [photo()], 'a'.repeat(3000)))).toEqual([])
})

test('a feed photo more than 1% outside 4:5 or 1,91:1 is a warning', () => {
  expect(codes(view('photo', [photo({ width: 1069, height: 1350 })]))).toEqual([
    'photo_aspect_ratio',
  ])
  expect(codes(view('photo', [photo({ width: 1931, height: 1000 })]))).toEqual([
    'photo_aspect_ratio',
  ])
})

test("an iPhone's 4:5 HEIC of 3427×4284 is 4:5", () => {
  // 0,7999: the phone rounds its pixels (D-120.4)
  expect(codes(view('photo', [photo({ width: 3427, height: 4284 })]))).toEqual([])
  expect(codes(view('photo', [photo({ width: 1079, height: 1350 })]))).toEqual([])
  expect(codes(view('photo', [photo({ width: 1920, height: 1000 })]))).toEqual([])
})

test('a phone video of 1080×1918 is 9:16', () => {
  expect(codes(view('reel', [video(10_000, { width: 1080, height: 1918 })]))).toEqual([])
})

test('the quota warns under 5 posts left, and blocks at none', () => {
  const left = (used: number, at = CHECKED_AT) =>
    INSTAGRAM_RULES.checkAccount(
      view('photo', [photo()]),
      {
        ...ruleAccount({
          platform: 'instagram',
          quota: { used, total: 100, checkedAt: CHECKED_AT },
        }),
        id: 'a',
      },
      NO_HISTORY,
      at,
    ).map((f) => f.code)
  expect(left(95)).toEqual([])
  expect(left(96)).toEqual(['quota_low'])
  expect(left(99)).toEqual(['quota_low'])
  expect(left(100)).toEqual(['quota_exhausted'])
  // 24 hours after Meta counted them, those posts no longer count
  expect(left(100, new Date(CHECKED_AT.getTime() + 24 * 3_600_000 - 60_000))).toEqual([
    'quota_exhausted',
  ])
  expect(left(100, new Date(CHECKED_AT.getTime() + 24 * 3_600_000))).toEqual([])
})

test('an account with no quota read has no quota check', () => {
  const findings = INSTAGRAM_RULES.checkAccount(
    view('photo', [photo()]),
    { ...ruleAccount({ platform: 'instagram' }), id: 'a' },
    NO_HISTORY,
    CHECKED_AT,
  )
  expect(findings).toEqual([])
})
