import { describe, expect, test } from 'vitest'
import { DomainError } from '@app/domain'
import type { PostRecord } from '../ports/posts.js'
import { toCheckInput } from './to-check-input.js'

// The saved post as the checks take it (plan 06, Scelta 9).

const post = (over: Partial<PostRecord> = {}): PostRecord => ({
  id: '0190a000-0000-7000-8000-000000000001',
  organizationId: '0190a000-0000-7000-8000-0000000000aa',
  workspaceId: '0190a000-0000-7000-8000-0000000000bb',
  type: 'reel',
  caption: 'Il pane di oggi',
  captionByPlatform: { facebook: 'Su Facebook' },
  // 18:00 in Rome, summer time
  scheduledAt: new Date('2027-06-10T16:00:00Z'),
  timezone: 'Europe/Rome',
  status: 'draft',
  instagramCollaborators: ['forno.luce'],
  options: {
    shareToFeed: false,
    choices: [
      {
        key: 'photo_aspect_ratio:media:m1',
        option: 'crop',
        crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
      },
    ],
  },
  createdBy: '0190a000-0000-7000-8000-0000000000cc',
  scheduledBy: null,
  updatedBy: '0190a000-0000-7000-8000-0000000000cc',
  version: 3,
  trashedAt: null,
  trashedBy: null,
  createdAt: new Date('2026-11-18T10:00:00Z'),
  updatedAt: new Date('2026-11-18T10:00:00Z'),
  mediaIds: ['m1', 'm2'],
  cover: { source: 'frame', offsetMs: 1500 },
  targets: [
    { id: 't1', accountId: 'a1', status: 'draft', fingerprint: null, cancelledInPanel: false },
    { id: 't2', accountId: 'a2', status: 'draft', fingerprint: null, cancelledInPanel: false },
  ],
  labelIds: [],
  ...over,
})

describe('toCheckInput', () => {
  test('the post as saved: files, cover, texts, accounts, choices and its own id', () => {
    expect(toCheckInput(post(), 'save')).toEqual({
      workspaceId: '0190a000-0000-7000-8000-0000000000bb',
      type: 'reel',
      mediaIds: ['m1', 'm2'],
      cover: { source: 'frame', offsetMs: 1500 },
      caption: { common: 'Il pane di oggi', facebook: 'Su Facebook' },
      destinations: [{ accountId: 'a1' }, { accountId: 'a2' }],
      when: { mode: 'at', localDate: '2027-06-10', localTime: '18:00' },
      shareToFeed: false,
      instagramCollaborators: ['forno.luce'],
      choices: [
        {
          key: 'photo_aspect_ratio:media:m1',
          option: 'crop',
          crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
        },
      ],
      purpose: 'save',
      postId: '0190a000-0000-7000-8000-000000000001',
    })
  })

  test('the date in the post’s own time zone', () => {
    const input = toCheckInput(post({ timezone: 'America/New_York' }), 'publish')
    expect(input.when).toEqual({ mode: 'at', localDate: '2027-06-10', localTime: '12:00' })
    expect(input.purpose).toBe('publish')
  })

  test('a story sends no text, while the post keeps it', () => {
    const story = post({ type: 'story' })
    expect(toCheckInput(story, 'save').caption).toEqual({ common: '' })
    expect(story.caption).toBe('Il pane di oggi')
  })

  test('a story keeps its collaborators: the checks say they do not go out (D-125)', () => {
    expect(toCheckInput(post({ type: 'story' }), 'save').instagramCollaborators).toEqual([
      'forno.luce',
    ])
  })

  test('no cover, no cover in the checks', () => {
    expect(toCheckInput(post({ cover: null }), 'save')).not.toHaveProperty('cover')
  })

  test('a post with no date cannot be checked for scheduling', () => {
    expect(() => toCheckInput(post({ scheduledAt: null }), 'save')).toThrow(DomainError)
  })
})
