import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  CreatePostRequest,
  POST_LIMITS,
  POST_STATUSES,
  PostVersionRequest,
  UpdatePostRequest,
} from '@app/contracts'
import { POST_STATUSES as DOMAIN_POST_STATUSES } from '@app/domain'

// The bodies of the posts' routes are refused before any use case runs (plan 06 Task 4).

const refused = (schema: { safeParse(v: unknown): { success: boolean } }, body: unknown) => {
  expect(schema.safeParse(body).success).toBe(false)
}

test('the states of the contract are the domain’s', () => {
  expect([...POST_STATUSES]).toEqual([...DOMAIN_POST_STATUSES])
})

test('a new draft needs only its type; nothing unknown passes', () => {
  expect(CreatePostRequest.parse({ type: 'photo' })).toEqual({ type: 'photo' })
  expect(
    CreatePostRequest.safeParse({
      type: 'reel',
      mediaIds: [randomUUID()],
      cover: { source: 'frame', offsetMs: 0 },
      caption: { common: 'Il pane di oggi', instagram: '' },
      destinations: [{ accountId: randomUUID() }],
      when: { localDate: '2026-11-24', localTime: '18:00' },
      shareToFeed: false,
      choices: [{ key: 'quota_low:post', option: 'accept' }],
    }).success,
  ).toBe(true)
  // no date yet, no cover
  expect(CreatePostRequest.safeParse({ type: 'photo', when: null, cover: null }).success).toBe(true)
  refused(CreatePostRequest, {})
  refused(CreatePostRequest, { type: 'photo', when: { mode: 'now' } })
  refused(CreatePostRequest, { type: 'photo', status: 'scheduled' })
  refused(CreatePostRequest, { type: 'photo', organizationId: randomUUID() })
  refused(CreatePostRequest, { type: 'photo', createdBy: randomUUID() })
})

test('a save carries the version read', () => {
  expect(UpdatePostRequest.safeParse({ version: 3, caption: { common: 'x' } }).success).toBe(true)
  refused(UpdatePostRequest, { caption: { common: 'x' } })
  refused(UpdatePostRequest, { version: 0 })
  refused(UpdatePostRequest, { version: 1.5 })
  refused(UpdatePostRequest, { version: 1, scheduledBy: randomUUID() })
  expect(PostVersionRequest.safeParse({ version: 1 }).success).toBe(true)
  refused(PostVersionRequest, {})
})

test('the limits are those of the checks', () => {
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID())
  expect(
    UpdatePostRequest.safeParse({ version: 1, mediaIds: ids(POST_LIMITS.media) }).success,
  ).toBe(true)
  refused(UpdatePostRequest, { version: 1, mediaIds: ids(POST_LIMITS.media + 1) })
  refused(UpdatePostRequest, {
    version: 1,
    destinations: ids(POST_LIMITS.destinations + 1).map((accountId) => ({ accountId })),
  })
  refused(UpdatePostRequest, {
    version: 1,
    caption: { common: 'a'.repeat(POST_LIMITS.captionCharacters + 1) },
  })
  refused(UpdatePostRequest, {
    version: 1,
    choices: Array.from({ length: POST_LIMITS.choices + 1 }, (_, i) => ({
      key: `k${String(i)}`,
      option: 'accept',
    })),
  })
})
