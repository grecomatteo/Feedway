import { expect, test } from 'vitest'
import {
  centeredCrop,
  cropStyle,
  feedFrameRatio,
  frameAnswers,
  framing,
  previewTabs,
  shortCaption,
  viewOf,
} from '../app/utils/post-preview.ts'

// The preview's logic (plan 06 Task 6): the tabs of each type and destination, the frames
// after the answers, the text cut as the apps cut it.

const IG = 'ig-1'
const IG2 = 'ig-2'
const FB = 'fb-1'

test('every format of §9.1 has its view', () => {
  expect(viewOf('instagram', 'feed_photo')).toBe('instagram_feed')
  expect(viewOf('instagram', 'carousel')).toBe('instagram_feed')
  expect(viewOf('instagram', 'reel')).toBe('instagram_reel')
  expect(viewOf('instagram', 'story_photo')).toBe('instagram_story')
  expect(viewOf('instagram', 'story_video')).toBe('instagram_story')
  expect(viewOf('facebook', 'photo')).toBe('facebook_post')
  expect(viewOf('facebook', 'multi_photo')).toBe('facebook_post')
  // a long reel published «come video normale» is a post of the Page
  expect(viewOf('facebook', 'video')).toBe('facebook_post')
  expect(viewOf('facebook', 'reel')).toBe('facebook_reel')
  expect(viewOf('facebook', 'story_video')).toBe('facebook_story')
  // an account not of the client, or a post that cannot go there: no view
  expect(viewOf(null, 'reel')).toBeNull()
  expect(viewOf('facebook', null)).toBeNull()
})

test('only the tabs of the chosen accounts, in the order of the design, each with its accounts', () => {
  const carousel = previewTabs([
    { accountId: FB, platform: 'facebook', format: 'multi_photo' },
    { accountId: IG, platform: 'instagram', format: 'carousel' },
    { accountId: IG2, platform: 'instagram', format: 'carousel' },
  ])
  expect(carousel).toEqual([
    { view: 'instagram_feed', accountIds: [IG, IG2] },
    { view: 'facebook_post', accountIds: [FB] },
  ])
  const reel = previewTabs([
    { accountId: IG, platform: 'instagram', format: 'reel' },
    { accountId: FB, platform: 'facebook', format: 'reel' },
  ])
  expect(reel.map((t) => t.view)).toEqual(['instagram_reel', 'facebook_reel'])
  const story = previewTabs([{ accountId: FB, platform: 'facebook', format: 'story_photo' }])
  expect(story.map((t) => t.view)).toEqual(['facebook_story'])
  // the Page that cannot take the post has no tab
  expect(
    previewTabs([
      { accountId: IG, platform: 'instagram', format: 'reel' },
      { accountId: FB, platform: 'facebook', format: null },
    ]).map((t) => t.view),
  ).toEqual(['instagram_reel'])
  expect(previewTabs([])).toEqual([])
})

test('the box in the middle keeps the proportions in pixels', () => {
  // a 3:2 photo cut to 4:5: full height, the middle of the width
  const c = centeredCrop(4 / 5, 3000, 2000)
  expect(c.height).toBe(1)
  expect(c.y).toBe(0)
  expect((c.width * 3000) / (c.height * 2000)).toBeCloseTo(0.8)
  expect(c.x).toBeCloseTo((1 - c.width) / 2)
  // a 9:16 photo cut to 4:5: full width, the middle of the height
  const tall = centeredCrop(4 / 5, 1080, 1920)
  expect(tall.width).toBe(1)
  expect((1080 * tall.width) / (1920 * tall.height)).toBeCloseTo(0.8)
})

test('a file in its frame follows the answer to its warning', () => {
  const photo = { width: 3000, height: 2000 }
  const box = { x: 0.1, y: 0, width: 0.5, height: 1 }
  expect(framing(photo, 0.8, { option: 'crop', crop: box, cropRatio: 0.8 })).toEqual({
    mode: 'crop',
    crop: box,
  })
  // a crop with no box saved is the centre
  expect(framing(photo, 0.8, { option: 'crop', cropRatio: 0.8 }).crop).toEqual(
    centeredCrop(0.8, 3000, 2000),
  )
  expect(framing(photo, 0.8, { option: 'pad', cropRatio: 0.8 }).mode).toBe('contain')
  // a reel's video: whole, with bands or cut in the middle to 9:16
  const video = { width: 1920, height: 1080 }
  expect(framing(video, 9 / 16, { option: 'keep' }, 'contain').mode).toBe('contain')
  expect(framing(video, 9 / 16, { option: 'crop_center' }).crop).toEqual(
    centeredCrop(9 / 16, 1920, 1080),
  )
  // nothing to answer: the fallback
  expect(framing(photo, 1.5, null)).toEqual({ mode: 'fill', crop: null })
  expect(framing(video, 9 / 16, null, 'contain').mode).toBe('contain')
})

test("the feed's frame takes the first file's proportions, within 4:5 and 1.91:1", () => {
  expect(feedFrameRatio({ width: 1080, height: 1080 }, null)).toBe(1)
  expect(feedFrameRatio({ width: 1080, height: 1920 }, null)).toBe(0.8)
  expect(feedFrameRatio({ width: 4000, height: 1000 }, null)).toBe(1.91)
  expect(feedFrameRatio({ width: 1080, height: 1920 }, { option: 'crop', cropRatio: 0.8 })).toBe(
    0.8,
  )
  expect(feedFrameRatio(undefined, null)).toBe(1)
})

test('the image inside the box shows only the box', () => {
  expect(cropStyle({ x: 0.25, y: 0, width: 0.5, height: 1 })).toMatchObject({
    width: '200%',
    height: '100%',
    left: '-50%',
    top: '0%',
  })
})

test('the answers of one platform, by file', () => {
  const outcomes = [
    {
      code: 'photo_aspect_ratio',
      key: 'photo_aspect_ratio:media:m1:instagram',
      subject: { kind: 'media', index: 0 },
      platform: 'instagram',
      chosen: 'crop',
      cropRatio: 0.8,
    },
    {
      code: 'reel_aspect_ratio',
      key: 'reel_aspect_ratio:media:m2',
      subject: { kind: 'media', index: 1 },
    },
    { code: 'caption_too_long', key: 'x', subject: { kind: 'post' }, platform: 'instagram' },
  ]
  const box = { x: 0, y: 0.1, width: 1, height: 0.5 }
  const choices = [
    { key: 'photo_aspect_ratio:media:m1:instagram', option: 'crop', crop: box },
    { key: 'reel_aspect_ratio:media:m2', option: 'pad' },
  ]
  const ig = frameAnswers(outcomes, choices, 'instagram')
  expect(ig.get(0)).toEqual({ option: 'crop', crop: box, cropRatio: 0.8 })
  expect(ig.get(1)).toEqual({ option: 'pad' })
  // Facebook has no warning on the photo: only the reel's, which is of both
  const fb = frameAnswers(outcomes, choices, 'facebook')
  expect([...fb.keys()]).toEqual([1])
})

test('the text closed: two lines or so many characters, then «altro»', () => {
  const limits = { chars: 20, lines: 2 }
  expect(shortCaption('Pane di segale', limits)).toEqual({ text: 'Pane di segale', cut: false })
  expect(shortCaption('Riga uno\nRiga due\nRiga tre', limits)).toEqual({
    text: 'Riga uno\nRiga due',
    cut: true,
  })
  expect(shortCaption('Il pane di segale è tornato', limits)).toEqual({
    text: 'Il pane di segale è',
    cut: true,
  })
  // emoji count as one, as the counters
  expect(shortCaption('🍞'.repeat(25), limits).text).toBe('🍞'.repeat(20))
  // only spaces after: nothing more to open
  expect(shortCaption('Pane  \n', limits)).toEqual({ text: 'Pane', cut: false })
})
