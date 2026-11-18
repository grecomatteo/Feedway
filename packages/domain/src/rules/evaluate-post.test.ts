import { describe, expect, it, test } from 'vitest'
import { DomainError } from '../errors.js'
import { FB, IG, RULE_CASES, context, draft, photo, video } from './cases.js'
import {
  evaluatePost,
  isValidCrop,
  mediaKeys,
  outcomeKey,
  postFingerprint,
} from './evaluate-post.js'
import { platformRulesMap } from './platform-rules.js'
import { INSTAGRAM_RULES } from '../platforms/meta/rules/index.js'
import type { MediaFailure } from '../media/processing.js'
import type { PlatformRules, RuleOutcome, RuleReport } from './types.js'

const short = (o: RuleOutcome) => {
  const subject =
    o.subject.kind === 'media'
      ? `media:${String(o.subject.index)}`
      : o.subject.kind === 'destination'
        ? `destination:${o.subject.accountId}`
        : o.subject.kind
  return {
    level: o.level,
    code: o.code,
    subject,
    ...(o.platform ? { platform: o.platform } : {}),
    ...(o.chosen ? { chosen: o.chosen } : {}),
  }
}
const sortKey = (x: { code: string; subject: string; platform?: string }) =>
  `${x.code} ${x.subject} ${x.platform ?? ''}`
const byKey = (a: { code: string; subject: string }, b: { code: string; subject: string }) =>
  sortKey(a).localeCompare(sortKey(b))

describe('the cases of §9.1–9.2', () => {
  it.each(RULE_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const report = evaluatePost(c.draft, c.context)
    expect(report.outcomes.map(short).sort(byKey)).toEqual([...c.expected].sort(byKey))
    if (c.destinations)
      expect(
        report.destinations.map(({ accountId, format, media }) => ({ accountId, format, media })),
      ).toEqual(c.destinations)
  })

  test('every reason a file fails has a case of its own (§9.2 «File»)', () => {
    const reasons: Record<MediaFailure['code'], true> = {
      unsupported_type: true,
      too_large: true,
      too_many_pixels: true,
      too_long: true,
      unreadable: true,
      timeout: true,
      storage_full: true,
      processing_failed: true,
    }
    const covered = new Set(
      RULE_CASES.flatMap((c) =>
        c.expected.some((e) => e.code === 'media_failed')
          ? c.draft.media.flatMap((m) => (m.failure ? [m.failure.code] : []))
          : [],
      ),
    )
    expect([...covered].sort()).toEqual(Object.keys(reasons).sort())
  })

  test('the ids are unique', () => {
    const ids = RULE_CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

const destination = (report: RuleReport, accountId: string) => {
  const found = report.destinations.find((x) => x.accountId === accountId)
  if (!found) throw new Error(`no destination ${accountId}`)
  return found
}

/** The codes of the outcomes a destination lists by key, in its order. */
const codesOf = (report: RuleReport, keys: readonly string[]) =>
  keys.map((k) => report.outcomes.find((o) => o.key === k)?.code)

const keyOf = (report: RuleReport, code: string) => {
  const found = report.outcomes.find((o) => o.code === code)
  if (!found) throw new Error(`no outcome ${code}`)
  return found.key
}

const mixed = () =>
  draft({
    type: 'carousel',
    media: [photo(), video(10_000, { width: 1080, height: 1350 }), photo()],
  })

describe('choices', () => {
  test('a valid choice resolves its warning and lets the post be scheduled', () => {
    const d = draft({ media: [photo({ width: 1080, height: 1920 }, { mediaId: 'p1' })] })
    const before = evaluatePost(d, context())
    expect(before.canSchedule).toBe(false)
    expect(before.unresolved).toEqual(['photo_aspect_ratio:media:p1:instagram'])
    const after = evaluatePost(
      { ...d, choices: [{ key: before.unresolved[0] ?? '', option: 'crop' }] },
      context(),
    )
    expect(after.unresolved).toEqual([])
    expect(after.canSchedule).toBe(true)
    expect(after.outcomes[0]).toMatchObject({
      code: 'photo_aspect_ratio',
      chosen: 'crop',
      cropRatio: 0.8,
    })
  })

  test('an option the engine does not know is refused', () => {
    const d = draft({ choices: [{ key: 'x', option: 'delete_all' as never }] })
    expect(() => evaluatePost(d, context())).toThrow(DomainError)
  })

  test('two choices for the same warning are refused', () => {
    const key = 'photo_aspect_ratio:media:p1:instagram'
    const d = draft({
      choices: [
        { key, option: 'pad' },
        { key, option: 'crop' },
      ],
    })
    expect(() => evaluatePost(d, context())).toThrow(DomainError)
  })

  test('an option the warning does not offer is left out, and the warning is open again (D-54)', () => {
    const key = 'photo_aspect_ratio:media:p1:instagram'
    const d = draft({
      media: [photo({ width: 1080, height: 1920 }, { mediaId: 'p1' })],
      choices: [{ key, option: 'skip_platform' }],
    })
    const report = evaluatePost(d, context())
    expect(report.invalidChoices).toEqual([{ key, option: 'skip_platform' }])
    expect(report.unresolved).toEqual([key])
    expect(report.outcomes[0]?.chosen).toBeUndefined()
    expect(report.canSchedule).toBe(false)
  })

  test('a valid choice says no invalid choice', () => {
    const key = 'photo_aspect_ratio:media:p1:instagram'
    const d = draft({
      media: [photo({ width: 1080, height: 1920 }, { mediaId: 'p1' })],
      choices: [{ key, option: 'pad' }],
    })
    expect(evaluatePost(d, context()).invalidChoices).toEqual([])
  })

  test('a choice for a warning that is no longer there does nothing', () => {
    // the photo was replaced by one in 4:5: its old choice is ignored
    const d = draft({
      media: [photo({}, { mediaId: 'p1' })],
      choices: [{ key: 'photo_aspect_ratio:media:p1:instagram', option: 'pad' }],
    })
    const report = evaluatePost(d, context())
    expect(report.outcomes).toEqual([])
    expect(report.canSchedule).toBe(true)
  })

  test('a destination says the choice that shaped it, not the files it leaves out', () => {
    // the video (index 1) needs converting; Facebook publishes only the photos
    const d = draft({
      type: 'carousel',
      media: [
        photo(),
        video(
          10_000,
          { width: 1080, height: 1350 },
          { checks: { fixes: [], warnings: [{ code: 'convert_codec' }] } },
        ),
        photo(),
      ],
      choices: [{ key: 'carousel_mixed_with_facebook:post:facebook', option: 'photos_only' }],
    })
    const report = evaluatePost(d, context())
    expect(codesOf(report, destination(report, FB).outcomeKeys)).toEqual([
      'carousel_mixed_with_facebook',
    ])
    expect(codesOf(report, destination(report, IG).outcomeKeys)).toEqual(['file_convert_codec'])
  })

  test('skipping the only platform leaves no destination', () => {
    const d = { ...mixed(), destinations: [{ accountId: FB }] }
    const key = keyOf(evaluatePost(d, context()), 'carousel_mixed_with_facebook')
    const report = evaluatePost({ ...d, choices: [{ key, option: 'skip_platform' }] }, context())
    expect(report.outcomes.map((o) => o.code)).toContain('no_destinations')
    expect(report.canSchedule).toBe(false)
  })

  test('a choice that changes the post changes its fingerprint too', () => {
    // Facebook had the two photos already: with «solo le foto» this is a duplicate
    const d = { ...mixed(), destinations: [{ accountId: FB }] }
    const photos = [d.media[0]?.sha256 ?? '', d.media[2]?.sha256 ?? '']
    const seen = new Set([postFingerprint(FB, photos, d.caption.common)])
    const ctx = context({ history: { recentFingerprints: new Map([[FB, seen]]) } })
    const key = keyOf(evaluatePost(d, ctx), 'carousel_mixed_with_facebook')
    const report = evaluatePost({ ...d, choices: [{ key, option: 'photos_only' }] }, ctx)
    expect(report.outcomes.map((o) => o.code)).toContain('duplicate_post')
  })
})

describe('the report', () => {
  test('a block stops the scheduling, a fix does not', () => {
    expect(
      evaluatePost(draft({ caption: { common: 'a'.repeat(2201) } }), context()).canSchedule,
    ).toBe(false)
    const fixed = draft({
      media: [photo({}, { checks: { fixes: [{ code: 'strip_metadata' }], warnings: [] } })],
    })
    expect(evaluatePost(fixed, context()).canSchedule).toBe(true)
  })

  test('«Pubblica ora» has no date to check, and no scheduled instant', () => {
    const report = evaluatePost(draft({ when: { mode: 'now' } }), context())
    expect(report.scheduledAt).toBeNull()
    expect(report.canSchedule).toBe(true)
  })

  test('the instant of a time that happens twice is the first of the two', () => {
    const report = evaluatePost(
      draft({ when: { mode: 'at', localDate: '2026-10-25', localTime: '02:30' } }),
      { ...context(), now: new Date('2026-10-01T00:00:00Z') },
    )
    expect(report.scheduledAt).toEqual(new Date('2026-10-25T00:30:00Z'))
    expect(report.outcomes[0]).toMatchObject({
      code: 'time_ambiguous',
      params: { time: '02:30', offset: '+02:00' },
    })
  })

  test('the time that does not exist says the time it will be published at', () => {
    const report = evaluatePost(
      draft({ when: { mode: 'at', localDate: '2027-03-28', localTime: '02:30' } }),
      context(),
    )
    expect(report.outcomes[0]).toMatchObject({
      code: 'time_skipped',
      params: { time: '03:30', offset: '+02:00' },
    })
  })

  test('each destination says the text it will publish and the outcomes that touch it', () => {
    const report = evaluatePost(
      draft({ caption: { common: 'Comune', instagram: 'a'.repeat(2201) } }),
      context(),
    )
    const ig = destination(report, IG)
    const fb = destination(report, FB)
    expect(ig).toMatchObject({
      platform: 'instagram',
      format: 'feed_photo',
      caption: 'a'.repeat(2201),
    })
    expect(codesOf(report, ig.outcomeKeys)).toEqual(['caption_too_long'])
    expect(fb).toMatchObject({
      platform: 'facebook',
      format: 'photo',
      caption: 'Comune',
      outcomeKeys: [],
    })
  })

  test('an account that is not available says nothing but its id', () => {
    const report = evaluatePost(
      draft({ destinations: [{ accountId: 'acc-other-workspace' }] }),
      context(),
    )
    expect(report.destinations).toEqual([
      {
        accountId: 'acc-other-workspace',
        platform: null,
        format: null,
        caption: '',
        media: [],
        fingerprint: null,
        outcomeKeys: ['account_unavailable:destination:acc-other-workspace'],
      },
    ])
  })

  test('each outcome is said once: destinations and post list it by key', () => {
    const report = evaluatePost(
      draft({
        media: [
          photo(
            {},
            { mediaId: 'p1', checks: { fixes: [{ code: 'strip_metadata' }], warnings: [] } },
          ),
        ],
        caption: { common: 'a'.repeat(2201) },
      }),
      context(),
    )
    expect(report.outcomes.map((o) => o.key).sort()).toEqual([
      'caption_too_long:post:instagram',
      'file_strip_metadata:media:p1',
    ])
    expect(report.postKeys.sort()).toEqual(report.outcomes.map((o) => o.key).sort())
    expect(destination(report, IG).outcomeKeys.sort()).toEqual([
      'caption_too_long:post:instagram',
      'file_strip_metadata:media:p1',
    ])
    expect(destination(report, FB).outcomeKeys).toEqual(['file_strip_metadata:media:p1'])
  })

  test('the seconds next to a limit are rounded towards its wrong side (P3)', () => {
    const short = evaluatePost(draft({ type: 'reel', media: [video(2_960)] }), context())
    expect(short.outcomes[0]).toMatchObject({
      code: 'reel_too_short',
      params: { limit: 3, found: 2.9 },
    })
    const long = evaluatePost(draft({ type: 'reel', media: [video(90_040)] }), context())
    expect(long.outcomes[0]).toMatchObject({
      code: 'reel_too_long_for_facebook',
      params: { limit: 90, found: 90.1 },
    })
  })

  test('the seconds of a story are rounded the same way (P3)', () => {
    const story = (ms: number) =>
      evaluatePost(draft({ type: 'story', media: [video(ms)], caption: { common: '' } }), context())
        .outcomes[0]
    expect(story(2_960)).toMatchObject({
      code: 'story_too_short',
      params: { limit: 3, found: 2.9 },
    })
    expect(story(60_040)).toMatchObject({
      code: 'story_too_long',
      params: { limit: 60, found: 60.1 },
    })
  })

  test('a frame after the end of the video blocks, with both times (P2)', () => {
    const report = evaluatePost(
      draft({
        type: 'reel',
        media: [video(10_000)],
        destinations: [{ accountId: IG }],
        cover: { source: 'frame', offsetMs: 600_000 },
      }),
      context(),
    )
    expect(report.outcomes).toEqual([
      expect.objectContaining({
        code: 'cover_frame_out_of_range',
        params: { found: 600, limit: 10 },
      }),
    ])
    expect(report.canSchedule).toBe(false)
  })

  test('the same account twice is one destination', () => {
    const report = evaluatePost(
      draft({ destinations: [{ accountId: IG }, { accountId: IG }] }),
      context(),
    )
    expect(report.destinations).toHaveLength(1)
  })

  test('a story has no caption on any destination', () => {
    const report = evaluatePost(
      draft({ type: 'story', caption: { common: 'Testo' }, choices: [] }),
      context(),
    )
    expect(report.destinations.map((x) => x.caption)).toEqual(['', ''])
    expect(report.destinations.map((x) => x.format)).toEqual(['story_photo', 'story_photo'])
  })

  test('the key of an outcome is its code, subject and platform', () => {
    expect(
      outcomeKey({
        code: 'photo_aspect_ratio',
        subject: { kind: 'media', index: 2 },
        platform: 'facebook',
      }),
    ).toBe('photo_aspect_ratio:media:2:facebook')
    expect(
      outcomeKey({ code: 'quota_low', subject: { kind: 'destination', accountId: 'a' } }),
    ).toBe('quota_low:destination:a')
  })
})

describe('platforms', () => {
  const noStories: PlatformRules = {
    platform: 'facebook',
    photoMaxBytes: 1,
    format: (type) => (type === 'story' ? null : 'post'),
    checkPost: () => [],
    checkAccount: () => [],
  }

  test('a type the platform does not have blocks its destinations only', () => {
    const ctx = { ...context(), platforms: platformRulesMap([INSTAGRAM_RULES, noStories]) }
    const report = evaluatePost(draft({ type: 'story', caption: { common: '' } }), ctx)
    expect(report.outcomes.map((o) => [o.code, o.platform])).toEqual([
      ['type_not_supported', 'facebook'],
    ])
    expect(destination(report, IG).outcomeKeys).toEqual([])
  })

  test('an account of a platform with no rules is blocked', () => {
    const ctx = { ...context(), platforms: platformRulesMap([INSTAGRAM_RULES]) }
    const report = evaluatePost(draft(), ctx)
    expect(report.outcomes.map((o) => o.code)).toEqual(['platform_unsupported'])
  })
})

test('the fingerprint ignores the spaces at the ends and how the lines are broken (D-50)', () => {
  const same = postFingerprint('a', ['s1'], 'Il pane\n\n di oggi')
  expect(postFingerprint('a', ['s1'], '  Il pane di oggi \n')).toBe(same)
  expect(postFingerprint('a', ['s1'], 'Il pane\r\ndi oggi')).toBe(same)
  expect(postFingerprint('a', ['s1'], 'Il pane di ieri')).not.toBe(same)
  expect(postFingerprint('a', ['s2', 's1'], 'Il pane di oggi')).not.toBe(
    postFingerprint('a', ['s1', 's2'], 'Il pane di oggi'),
  )
})

test('each destination carries the fingerprint of what it publishes, as hex sha256 (P3)', () => {
  const report = evaluatePost(draft({ caption: { common: 'Ciao' } }), context())
  expect(report.destinations.length).toBeGreaterThan(0)
  for (const d of report.destinations) {
    expect(d.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  }
})

describe('plan 06: keys by file, crops, unused files, purpose', () => {
  // 3:2, wider than 1.91:1? no: 1.5 is inside Instagram's range; 1:2 is taller than 4:5
  const tall = (mediaId: string) => photo({ width: 1000, height: 2000 }, { mediaId })
  // a 4:5 box of the 1000×2000 photo: 1000×1250 pixels
  const box = (y: number) => ({ x: 0, y, width: 1, height: 0.625 })
  const keyOf = (mediaId: string) => `photo_aspect_ratio:media:${mediaId}:instagram`

  test('the same file twice has two keys; a file keeps its key when the files move', () => {
    expect(mediaKeys([{ mediaId: 'a' }, { mediaId: 'b' }, { mediaId: 'a' }])).toEqual([
      'a',
      'b',
      'a:2',
    ])
    const first = evaluatePost(
      draft({ type: 'carousel', media: [tall('a'), photo({}, { mediaId: 'b' })] }),
      context(),
    )
    const moved = evaluatePost(
      draft({ type: 'carousel', media: [photo({}, { mediaId: 'b' }), tall('a')] }),
      context(),
    )
    expect(first.unresolved).toContain(keyOf('a'))
    // only the first file of a carousel is judged for its proportions: now it is b, in 4:5
    expect(moved.unresolved).not.toContain(keyOf('a'))
  })

  test('two tall photos with different boxes, swapped, keep each its own box', () => {
    const choices = [
      { key: keyOf('a'), option: 'crop' as const, crop: box(0) },
      { key: keyOf('b'), option: 'crop' as const, crop: box(0.375) },
    ]
    for (const media of [
      [tall('a'), tall('b')],
      [tall('b'), tall('a')],
    ]) {
      const report = evaluatePost(
        draft({ type: 'photo', media: [media[0] ?? tall('x')], choices }),
        context(),
      )
      expect(report.invalidChoices).toEqual([])
      expect(report.outcomes.find((o) => o.code === 'photo_aspect_ratio')).toMatchObject({
        key: keyOf(media[0]?.mediaId ?? ''),
        chosen: 'crop',
      })
    }
  })

  test.each([
    ['inside the photo, in 4:5', box(0.2), true],
    ['without a box: the centre', undefined, true],
    ['out of the photo', box(0.5), false],
    ['with the wrong proportions', { x: 0, y: 0, width: 1, height: 0.5 }, false],
    ['shorter than 320 pixels', { x: 0, y: 0, width: 0.3, height: 0.1875 }, false],
    ['with a negative corner', { x: -0.1, y: 0, width: 1, height: 0.625 }, false],
  ])('a crop %s is %s', (_name, crop, valid) => {
    const choice = { key: keyOf('a'), option: 'crop' as const, ...(crop ? { crop } : {}) }
    const report = evaluatePost(draft({ media: [tall('a')], choices: [choice] }), context())
    expect(report.invalidChoices).toEqual(valid ? [] : [choice])
    expect(report.unresolved).toEqual(valid ? [] : [keyOf('a')])
  })

  test('isValidCrop checks the box against the format', () => {
    const target = { ratio: 9 / 16, width: 1080, height: 1080 }
    expect(isValidCrop({ x: 0.2, y: 0, width: 0.5625, height: 1 }, target)).toBe(true)
    expect(isValidCrop({ x: 0.5, y: 0, width: 0.5625, height: 1 }, target)).toBe(false)
  })

  test('a file no destination publishes only says so (D-56)', () => {
    const failed = video(
      10_000,
      { width: 1080, height: 1350 },
      { mediaId: 'v', status: 'failed', failure: { code: 'unreadable' } as MediaFailure },
    )
    const d = draft({ type: 'carousel', media: [photo(), failed, photo()] })
    const report = evaluatePost(
      {
        ...d,
        destinations: [{ accountId: FB }],
        choices: [{ key: 'carousel_mixed_with_facebook:post:facebook', option: 'photos_only' }],
      },
      context(),
    )
    const aboutVideo = report.outcomes.filter(
      (o) => o.subject.kind === 'media' && o.subject.index === 1,
    )
    expect(aboutVideo.map((o) => [o.level, o.code])).toEqual([['fix', 'media_unused']])
    expect(aboutVideo[0]?.key).toBe('media_unused:media:v')
  })

  test('the worker checks a post whose time is past without the block (D-54)', () => {
    const past = draft({ when: { mode: 'at', localDate: '2026-11-01', localTime: '18:00' } })
    expect(evaluatePost(past, context()).outcomes.map((o) => o.code)).toContain('scheduled_in_past')
    expect(
      evaluatePost(past, context({ purpose: 'publish' })).outcomes.map((o) => o.code),
    ).not.toContain('scheduled_in_past')
  })

  test('a time the clock change skips says the zone of the post (D-58)', () => {
    const skipped = draft({ when: { mode: 'at', localDate: '2027-03-14', localTime: '02:30' } })
    const report = evaluatePost(skipped, context({ timeZone: 'America/New_York' }))
    expect(report.outcomes.find((o) => o.code === 'time_skipped')?.params).toMatchObject({
      time: '03:30',
      timeZone: 'America/New_York',
    })
  })
})
