import { describe, expect, it, test } from 'vitest'
import { DomainError } from '../errors.js'
import { FB, IG, RULE_CASES, context, draft, photo, video } from './cases.js'
import { evaluatePost, outcomeKey, postFingerprint } from './evaluate-post.js'
import { platformRulesMap } from './platform-rules.js'
import { INSTAGRAM_RULES } from '../platforms/meta/rules/index.js'
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
    const d = draft({ media: [photo({ width: 1080, height: 1920 })] })
    const before = evaluatePost(d, context())
    expect(before.canSchedule).toBe(false)
    expect(before.unresolved).toEqual(['photo_aspect_ratio:media:0:instagram'])
    const after = evaluatePost(
      { ...d, choices: [{ key: before.unresolved[0] ?? '', option: 'crop_center' }] },
      context(),
    )
    expect(after.unresolved).toEqual([])
    expect(after.canSchedule).toBe(true)
    expect(after.outcomes[0]).toMatchObject({ code: 'photo_aspect_ratio', chosen: 'crop_center' })
  })

  test('an option the engine does not know is refused', () => {
    const d = draft({ choices: [{ key: 'x', option: 'delete_all' as never }] })
    expect(() => evaluatePost(d, context())).toThrow(DomainError)
  })

  test('two choices for the same warning are refused', () => {
    const key = 'photo_aspect_ratio:media:0:instagram'
    const d = draft({
      choices: [
        { key, option: 'pad' },
        { key, option: 'crop_center' },
      ],
    })
    expect(() => evaluatePost(d, context())).toThrow(DomainError)
  })

  test('an option the warning does not offer is refused', () => {
    const d = draft({
      media: [photo({ width: 1080, height: 1920 })],
      choices: [{ key: 'photo_aspect_ratio:media:0:instagram', option: 'skip_platform' }],
    })
    expect(() => evaluatePost(d, context())).toThrow(DomainError)
  })

  test('a choice for a warning that is no longer there does nothing', () => {
    // the photo was replaced by one in 4:5: its old choice is ignored
    const d = draft({ choices: [{ key: 'photo_aspect_ratio:media:0:instagram', option: 'pad' }] })
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
    expect(destination(report, FB).outcomes.map((o) => o.code)).toEqual([
      'carousel_mixed_with_facebook',
    ])
    expect(destination(report, IG).outcomes.map((o) => o.code)).toEqual(['file_convert_codec'])
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
    expect(ig.outcomes.map((o) => o.code)).toEqual(['caption_too_long'])
    expect(fb).toMatchObject({
      platform: 'facebook',
      format: 'photo',
      caption: 'Comune',
      outcomes: [],
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
        outcomes: [expect.objectContaining({ code: 'account_unavailable' })],
      },
    ])
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
    expect(destination(report, IG).outcomes).toEqual([])
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
