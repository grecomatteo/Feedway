import { describe, expect, it } from 'vitest'
import {
  deleteBlockFix,
  deleteBlockText,
  folderBlockText,
  mediaUseLabel,
} from '../app/utils/media-use.ts'

// a translator that shows the key and what it was given
const t = (key: string, named: Record<string, unknown> = {}) =>
  `${key}${Object.keys(named).length > 0 ? ` ${JSON.stringify(named)}` : ''}`

const now = new Date('2026-11-19T09:00:00Z')
const use = (over: Record<string, unknown> = {}) => ({
  postId: 'p',
  status: 'scheduled' as const,
  scheduledAt: '2026-11-19T17:00:00Z',
  timezone: 'Europe/Rome',
  count: 1,
  ...over,
})

describe('mediaUseLabel (D-80.7)', () => {
  it('says nothing for a file no post uses', () => {
    expect(mediaUseLabel(null, t, now)).toBeNull()
  })

  it('names the scheduled post by its day and time in the post’s zone', () => {
    expect(mediaUseLabel(use(), t, now)).toBe('library.inPosts.scheduled {"when":"oggi, 18:00"}')
    expect(mediaUseLabel(use({ scheduledAt: '2026-11-20T07:00:00Z' }), t, now)).toBe(
      'library.inPosts.scheduled {"when":"domani, 08:00"}',
    )
    expect(mediaUseLabel(use({ scheduledAt: '2026-11-27T17:00:00Z' }), t, now)).toBe(
      'library.inPosts.scheduled {"when":"ven 27 nov, 18:00"}',
    )
    // New York's evening is already tomorrow in Rome: the post's zone says the day
    expect(
      mediaUseLabel(
        use({ scheduledAt: '2026-11-20T00:30:00Z', timezone: 'America/New_York' }),
        t,
        now,
      ),
    ).toBe('library.inPosts.scheduled {"when":"oggi, 19:30"}')
  })

  it('says a draft or a cancelled post, or how many posts use the file', () => {
    expect(mediaUseLabel(use({ status: 'draft', scheduledAt: null }), t, now)).toBe(
      'library.inPosts.draft',
    )
    expect(mediaUseLabel(use({ status: 'cancelled' }), t, now)).toBe('library.inPosts.cancelled')
    expect(mediaUseLabel(use({ status: 'draft', count: 3 }), t, now)).toBe(
      'library.inPosts.many {"n":3}',
    )
  })
})

describe('mediaUseLabel of the publishing (plan 07 Scelta 5)', () => {
  it('a post on its way or paused is named as a scheduled one', () => {
    expect(mediaUseLabel(use({ status: 'publishing' }), t, now)).toBe(
      'library.inPosts.scheduled {"when":"oggi, 18:00"}',
    )
    expect(mediaUseLabel(use({ status: 'paused' }), t, now)).toBe(
      'library.inPosts.scheduled {"when":"oggi, 18:00"}',
    )
  })
  it('a post gone out says the day, in the post’s zone, whatever the count', () => {
    for (const status of ['published', 'partial', 'problem'] as const)
      expect(
        mediaUseLabel(use({ status, scheduledAt: '2026-11-17T23:30:00Z', count: 2 }), t, now),
      ).toBe('library.inPosts.published {"day":"18 novembre"}')
  })
  it('a post that did not go out', () => {
    expect(mediaUseLabel(use({ status: 'failed' }), t, now)).toBe('library.inPosts.notOut')
  })
})

describe('deleteBlockText (D-80.4)', () => {
  const block = {
    reason: 'in_scheduled_post' as const,
    postId: 'p',
    scheduledAt: '2026-11-19T17:00:00Z',
    timezone: 'Europe/Rome',
    count: 1,
  }
  it('says why the file is not deleted, before anyone tries', () => {
    expect(deleteBlockText(block, t, now)).toBe(
      'library.deleteBlocked.in_scheduled_post.one {"when":"oggi alle 18:00"}',
    )
    expect(deleteBlockText({ ...block, count: 2 }, t, now)).toBe(
      'library.deleteBlocked.in_scheduled_post.many {"n":2,"when":"oggi alle 18:00"}',
    )
    expect(deleteBlockFix(block, t)).toBe('library.deleteBlocked.in_scheduled_post.fix')
  })
  it('says what to do by the post that keeps the file (R10)', () => {
    for (const reason of ['in_publishing_post', 'in_paused_post', 'in_failed_post'] as const) {
      expect(deleteBlockText({ ...block, reason }, t, now)).toMatch(
        `library.deleteBlocked.${reason}.one`,
      )
      expect(deleteBlockFix({ ...block, reason }, t)).toBe(`library.deleteBlocked.${reason}.fix`)
    }
  })
  it('says how many files keep a folder', () => {
    expect(folderBlockText(1, t)).toBe('library.folders.deleteBlocked.one')
    expect(folderBlockText(3, t)).toBe('library.folders.deleteBlocked.many {"n":3}')
  })
})
