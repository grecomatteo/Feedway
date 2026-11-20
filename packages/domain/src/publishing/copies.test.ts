import { describe, expect, test } from 'vitest'
import { FB, IG, context, draft, photo, video } from '../rules/cases.js'
import { evaluatePost } from '../rules/evaluate-post.js'
import type { DraftMedia, PostDraft, RuleChoice } from '../rules/types.js'
import {
  distinctCopies,
  publishFilesOf,
  withFailedCopies,
  type PublishFile,
  type PublishPost,
} from './copies.js'

const LIMITS = new Map([
  ['instagram', 8_000_000],
  ['facebook', 4_000_000],
] as const)

/** The post as the worker made its files: a 2 MB copy for the feed, the reel's copy. */
function fileOf(m: DraftMedia, over: Partial<PublishFile> = {}): PublishFile {
  const a = m.analysis
  return {
    mediaId: m.mediaId,
    kind: m.kind,
    width: a && 'width' in a ? a.width : null,
    height: a && 'height' in a ? a.height : null,
    feedCopyBytes: m.kind === 'image' ? 2_000_000 : null,
    hasReelCopy: m.kind === 'video',
    ...over,
  }
}

function filesOf(d: PostDraft, over: Record<string, Partial<PublishFile>> = {}) {
  const report = evaluatePost(d, context({ purpose: 'publish' }))
  const post: PublishPost = {
    type: d.type,
    media: d.media.map((m) => fileOf(m, over[m.mediaId])),
    ...(d.cover
      ? {
          cover:
            d.cover.source === 'image'
              ? { source: 'image' as const, file: fileOf(d.cover.media) }
              : d.cover,
        }
      : {}),
    choices: d.choices,
  }
  const files = publishFilesOf(post, report, LIMITS)
  const of = (accountId: string) => files.find((f) => f.accountId === accountId)
  return { files, ig: of(IG), fb: of(FB), report }
}

describe('a photo', () => {
  test('in the format goes out as the copy made with it, everywhere', () => {
    const p = photo()
    const { ig, fb } = filesOf(draft({ media: [p] }))
    expect(ig?.media).toEqual([{ mediaId: p.mediaId, purpose: 'ig_feed', recipe: '' }])
    expect(fb?.media).toEqual([{ mediaId: p.mediaId, purpose: 'ig_feed', recipe: '' }])
    expect(ig?.cover).toBeNull()
  })

  test('cut to its box on Instagram only; Facebook takes it whole (D-61)', () => {
    const tall = photo({ width: 1000, height: 2000 })
    const box = { x: 0, y: 0.1, width: 1, height: 0.625 }
    const choices: RuleChoice[] = [
      { key: `photo_aspect_ratio:media:${tall.mediaId}:instagram`, option: 'crop', crop: box },
    ]
    const { ig, fb } = filesOf(draft({ media: [tall], choices }))
    expect(ig?.media).toEqual([
      { mediaId: tall.mediaId, purpose: 'ig_feed', recipe: 'crop-0-1000-10000-6250' },
    ])
    expect(fb?.media[0]?.recipe).toBe('')
  })

  test('«Ritaglia» without a box is the box at the centre', () => {
    const tall = photo({ width: 1000, height: 2000 })
    const choices: RuleChoice[] = [
      { key: `photo_aspect_ratio:media:${tall.mediaId}:instagram`, option: 'crop' },
    ]
    const { ig } = filesOf(draft({ media: [tall], choices }))
    expect(ig?.media[0]?.recipe).toBe('crop-0-1875-10000-6250')
  })

  test('with bands to 4:5', () => {
    const tall = photo({ width: 1000, height: 2000 })
    const choices: RuleChoice[] = [
      { key: `photo_aspect_ratio:media:${tall.mediaId}:instagram`, option: 'pad' },
    ]
    const { ig } = filesOf(draft({ media: [tall], choices }))
    expect(ig?.media[0]?.recipe).toBe('pad-8000')
  })

  test('over Facebook’s 4 MB gets a copy for Facebook; Instagram keeps its own (D-51)', () => {
    const p = photo()
    const { ig, fb } = filesOf(draft({ media: [p] }), {
      [p.mediaId]: { feedCopyBytes: 7_000_000 },
    })
    expect(ig?.media[0]).toEqual({ mediaId: p.mediaId, purpose: 'ig_feed', recipe: '' })
    expect(fb?.media[0]).toEqual({ mediaId: p.mediaId, purpose: 'fb_photo', recipe: 'fb' })
  })

  test('an orphan choice does nothing: only an answer the checks took counts', () => {
    const p = photo()
    const choices: RuleChoice[] = [
      { key: `photo_aspect_ratio:media:${p.mediaId}:instagram`, option: 'pad' },
    ]
    const { ig } = filesOf(draft({ media: [p], choices }))
    expect(ig?.media[0]?.recipe).toBe('')
  })
})

describe('a carousel', () => {
  test('moved, the box stays on its photo', () => {
    const tall = photo({ width: 1000, height: 2000 })
    const other = photo()
    const box = { x: 0, y: 0, width: 1, height: 0.625 }
    const choices: RuleChoice[] = [
      { key: `photo_aspect_ratio:media:${tall.mediaId}:instagram`, option: 'crop', crop: box },
    ]
    const first = filesOf(draft({ type: 'carousel', media: [tall, other], choices }))
    expect(first.ig?.media.map((m) => [m.mediaId, m.recipe])).toEqual([
      [tall.mediaId, 'crop-0-0-10000-6250'],
      [other.mediaId, ''],
    ])
    // second now: Instagram judges only the first, so the box is not used, nor moved
    const moved = filesOf(draft({ type: 'carousel', media: [other, tall], choices }))
    expect(moved.ig?.media.map((m) => [m.mediaId, m.recipe])).toEqual([
      [other.mediaId, ''],
      [tall.mediaId, ''],
    ])
  })

  test('a video in it goes out as its copy for the Reels', () => {
    const v = video(10_000, { width: 1080, height: 1350 })
    const p = photo()
    const { ig } = filesOf(
      draft({ type: 'carousel', media: [p, v], destinations: [{ accountId: IG }] }),
    )
    expect(ig?.media[1]).toEqual({ mediaId: v.mediaId, purpose: 'reel', recipe: '' })
  })
})

describe('a reel', () => {
  const wide = () => video(20_000, { width: 1920, height: 1080 })
  const reel = (v: DraftMedia, over: Partial<PostDraft> = {}) =>
    draft({ type: 'reel', media: [v], ...over })

  test.each([
    ['keep', ''],
    ['pad', 'reel-pad'],
    ['crop_center', 'reel-crop'],
  ] as const)('not 9:16, «%s»', (option, recipe) => {
    const v = wide()
    const { ig, fb } = filesOf(
      reel(v, { choices: [{ key: `reel_aspect_ratio:media:${v.mediaId}`, option }] }),
    )
    expect(ig?.media).toEqual([{ mediaId: v.mediaId, purpose: 'reel', recipe }])
    expect(fb?.media).toEqual(ig?.media)
  })

  test('with a codec Meta does not take is converted', () => {
    const v = video(20_000)
    const { ig } = filesOf(reel(v), { [v.mediaId]: { hasReelCopy: false } })
    expect(ig?.media[0]?.recipe).toBe('reel-convert')
  })

  test('the frame chosen becomes its cover, framed as the video', () => {
    const v = wide()
    const choices: RuleChoice[] = [{ key: `reel_aspect_ratio:media:${v.mediaId}`, option: 'pad' }]
    const { ig, fb } = filesOf(reel(v, { cover: { source: 'frame', offsetMs: 4_200 }, choices }))
    expect(ig?.cover).toEqual({ mediaId: v.mediaId, purpose: 'cover', recipe: 'frame-4200-pad' })
    expect(fb?.cover).toEqual(ig?.cover)
    const kept = filesOf(reel(v, { cover: { source: 'frame', offsetMs: 0 } }))
    expect(kept.ig?.cover?.recipe).toBe('frame-0-crop')
  })

  test('an uploaded cover is cut to its box, or kept as it is', () => {
    const v = video(20_000)
    const c = photo({ width: 1080, height: 1080 })
    const box = { x: 0.2, y: 0, width: 0.5625, height: 1 }
    const cut = filesOf(
      reel(v, {
        cover: { source: 'image', media: c },
        choices: [
          { key: `cover_aspect_ratio:cover:${c.mediaId}:instagram`, option: 'crop', crop: box },
        ],
      }),
    )
    expect(cut.ig?.cover).toEqual({
      mediaId: c.mediaId,
      purpose: 'cover',
      recipe: 'cover-2000-0-5625-10000',
    })
    const kept = filesOf(
      reel(v, {
        cover: { source: 'image', media: c },
        choices: [{ key: `cover_aspect_ratio:cover:${c.mediaId}:instagram`, option: 'keep' }],
      }),
    )
    expect(kept.ig?.cover?.recipe).toBe('cover')
  })
})

describe('a story', () => {
  test('a photo at the story’s size', () => {
    const p = photo()
    const { ig, fb } = filesOf(draft({ type: 'story', media: [p], caption: { common: '' } }))
    expect(ig?.media).toEqual([{ mediaId: p.mediaId, purpose: 'story', recipe: 'story' }])
    expect(fb?.media).toEqual(ig?.media)
  })

  test('a long video cut to 60 seconds when the warning said so', () => {
    const v = video(90_000)
    const { ig } = filesOf(
      draft({
        type: 'story',
        media: [v],
        caption: { common: '' },
        choices: [{ key: `story_too_long:media:${v.mediaId}`, option: 'trim_to_60' }],
      }),
    )
    expect(ig?.media[0]?.recipe).toBe('story-60000')
  })
})

test('the copies of all destinations, once each', () => {
  const p = photo()
  const { files } = filesOf(draft({ media: [p] }), { [p.mediaId]: { feedCopyBytes: 7_000_000 } })
  expect(distinctCopies(files)).toEqual([
    { mediaId: p.mediaId, purpose: 'ig_feed', recipe: '' },
    { mediaId: p.mediaId, purpose: 'fb_photo', recipe: 'fb' },
  ])
})

describe('a copy that could not be made', () => {
  test('blocks the check before publishing, on its file, for the destinations that use it', () => {
    const tall = photo({ width: 1000, height: 2000 })
    const choices: RuleChoice[] = [
      { key: `photo_aspect_ratio:media:${tall.mediaId}:instagram`, option: 'pad' },
    ]
    const d = draft({ media: [tall], choices })
    const { files, report } = filesOf(d)
    const post: PublishPost = { type: d.type, media: d.media.map((m) => fileOf(m)), choices }
    const request = { mediaId: tall.mediaId, purpose: 'ig_feed' as const, recipe: 'pad-8000' }
    const blocked = withFailedCopies(post, report, files, [{ request, failure: 'timeout' }])
    expect(blocked.canSchedule).toBe(false)
    const added = blocked.outcomes.filter((o) => o.code === 'media_copy_failed')
    expect(added).toEqual([
      {
        level: 'block',
        code: 'media_copy_failed',
        subject: { kind: 'media', index: 0 },
        params: { reason: 'timeout' },
        key: `media_copy_failed:media:${tall.mediaId}`,
      },
    ])
    const keysOf = (accountId: string) =>
      blocked.destinations.find((x) => x.accountId === accountId)?.outcomeKeys ?? []
    // Facebook publishes the photo whole: its copy is another one
    expect(keysOf(IG)).toContain(added[0]?.key)
    expect(keysOf(FB)).not.toContain(added[0]?.key)
    // a block about a file of the post, as every other one (`evaluatePost`)
    expect(blocked.postKeys).toContain(added[0]?.key)
  })

  test('on the cover', () => {
    const v = video(20_000)
    const d = draft({ type: 'reel', media: [v], cover: { source: 'frame', offsetMs: 100 } })
    const { files, report } = filesOf(d)
    const post: PublishPost = {
      type: 'reel',
      media: [fileOf(v)],
      cover: { source: 'frame', offsetMs: 100 },
      choices: [],
    }
    const request = { mediaId: v.mediaId, purpose: 'cover' as const, recipe: 'frame-100-crop' }
    const blocked = withFailedCopies(post, report, files, [{ request, failure: 'unreadable' }])
    expect(blocked.outcomes.find((o) => o.code === 'media_copy_failed')).toMatchObject({
      subject: { kind: 'cover' },
      key: 'media_copy_failed:cover',
    })
  })

  test('none failed: the report as it was', () => {
    const { files, report } = filesOf(draft())
    const post: PublishPost = { type: 'photo', media: [], choices: [] }
    expect(withFailedCopies(post, report, files, [])).toBe(report)
  })
})
