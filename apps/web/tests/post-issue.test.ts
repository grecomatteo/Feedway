import { describe, expect, it } from 'vitest'
import type { AgendaIssue } from '@app/contracts'
import {
  clientPostTrouble,
  postIssueReason,
  postIssueTitle,
  postIssueTone,
} from '../app/utils/post-issue.ts'

// a translator that shows the key and what it was given
const t = (key: string, named: Record<string, unknown> = {}) =>
  `${key}${Object.keys(named).length > 0 ? ` ${JSON.stringify(named)}` : ''}`
const te = (key: string) => !key.endsWith('.unknown_code')

const now = new Date('2026-11-19T15:00:00Z')
type PostIssue = AgendaIssue & { kind: 'post' }
const issue = (over: Partial<PostIssue> = {}): PostIssue => ({
  kind: 'post',
  workspaceId: 'w',
  postId: 'p',
  type: 'reel',
  status: 'partial',
  scheduledAt: '2026-11-19T08:30:00Z',
  timezone: 'Europe/Rome',
  platforms: ['facebook'],
  reason: 'media_rejected',
  notOut: 1,
  ...over,
})

describe('postIssueTitle (plan 07 Scelta 8, screen 02)', () => {
  it('a post of today by its time, with the type and where it did not go out', () => {
    expect(postIssueTitle(issue(), t, now)).toBe(
      'today.issues.post.failed.m {"type":"posts.type.reel","when":"delle 09:30","where":"Facebook"}',
    )
  })
  it('a photo or a story is feminine; an hour of one elides', () => {
    expect(
      postIssueTitle(
        issue({
          type: 'photo',
          scheduledAt: '2026-11-19T00:15:00Z',
          platforms: ['instagram', 'facebook'],
        }),
        t,
        now,
      ),
    ).toBe(
      'today.issues.post.failed.f {"type":"posts.type.photo","when":"dell’01:15","where":"Instagram e Facebook"}',
    )
  })
  it('another day by its date, elided where Italian elides', () => {
    expect(postIssueTitle(issue({ scheduledAt: '2026-11-08T08:30:00Z' }), t, now)).toContain(
      '"when":"dell’8 novembre"',
    )
    expect(postIssueTitle(issue({ scheduledAt: '2026-11-12T08:30:00Z' }), t, now)).toContain(
      '"when":"del 12 novembre"',
    )
  })
  it('paused and with a problem', () => {
    expect(postIssueTitle(issue({ status: 'paused' }), t, now)).toBe(
      'today.issues.post.paused {"type":"posts.type.reel","when":"delle 09:30","where":"Facebook"}',
    )
    expect(postIssueTitle(issue({ status: 'problem' }), t, now)).toContain(
      'today.issues.post.problem',
    )
  })
})

describe('postIssueTitle without an account', () => {
  it('says Meta when no account of the post is known any more', () => {
    expect(postIssueTitle(issue({ platforms: [] }), t, now)).toContain('"where":"Meta"')
  })
})

describe('postIssueReason', () => {
  it('the reason in a few words, by its code; a code without words says to open the post', () => {
    expect(postIssueReason(issue(), t, te)).toBe(
      'today.issues.post.reason.media_rejected {"platform":"Facebook"}',
    )
    expect(postIssueReason(issue({ reason: 'unknown_code' }), t, te)).toBe(
      'today.issues.post.reason.other',
    )
    expect(postIssueReason(issue({ reason: null }), t, te)).toBe('today.issues.post.reason.other')
  })
})

describe('postIssueTone and clientPostTrouble', () => {
  it('red when not out, amber when paused or with a problem', () => {
    expect(postIssueTone('failed')).toBe('danger')
    expect(postIssueTone('partial')).toBe('danger')
    expect(postIssueTone('paused')).toBe('warning')
    expect(postIssueTone('problem')).toBe('warning')
  })
  it('a client: the posts not out first, counted; else the paused or with a problem', () => {
    const items: AgendaIssue[] = [
      issue({ status: 'problem', postId: 'a' }),
      issue({ postId: 'b' }),
      issue({ status: 'failed', postId: 'c' }),
      issue({ workspaceId: 'other', postId: 'd' }),
    ]
    expect(clientPostTrouble(items, 'w')).toEqual({ status: 'notOut', count: 2 })
    expect(clientPostTrouble(items.slice(0, 1), 'w')).toEqual({ status: 'problem', count: 1 })
    expect(clientPostTrouble([issue({ status: 'paused' })], 'w')).toEqual({
      status: 'paused',
      count: 1,
    })
    expect(clientPostTrouble(items, 'none')).toBeNull()
  })
})
