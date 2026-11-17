import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  POST_CHECK_LIMITS,
  POST_CHECK_OPTIONS,
  POST_CHECK_TYPES,
  PostCheckRequest,
} from '@app/contracts'
import { POST_TYPES, RULE_OPTIONS } from '@app/domain'

// The body of `post-checks` is refused before any rule runs (plan 05, Review Focus 5): the
// panel is not the only defence.

const ok = () => ({
  type: 'photo',
  mediaIds: [randomUUID()],
  caption: { common: 'Il pane di oggi' },
  destinations: [{ accountId: randomUUID() }],
  when: { mode: 'at', localDate: '2026-11-18', localTime: '18:00' },
  choices: [],
})

const refused = (body: unknown) => {
  expect(PostCheckRequest.safeParse(body).success).toBe(false)
}

test('the lists of the contract are the domain’s', () => {
  expect([...POST_CHECK_TYPES]).toEqual([...POST_TYPES])
  expect([...POST_CHECK_OPTIONS]).toEqual([...RULE_OPTIONS])
})

describe('PostCheckRequest', () => {
  test('a usual post, «Pubblica ora» and a cover pass', () => {
    const body = ok()
    expect(PostCheckRequest.parse(body)).toEqual(body)
    expect(PostCheckRequest.safeParse({ ...ok(), when: { mode: 'now' } }).success).toBe(true)
    expect(
      PostCheckRequest.safeParse({
        ...ok(),
        type: 'reel',
        cover: { source: 'image', mediaId: randomUUID() },
        shareToFeed: false,
        caption: { common: '', instagram: '', facebook: 'Solo Facebook' },
      }).success,
    ).toBe(true)
  })

  test('up to 20 files and 100 destinations, no more', () => {
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID())
    expect(
      PostCheckRequest.safeParse({ ...ok(), mediaIds: ids(POST_CHECK_LIMITS.media) }).success,
    ).toBe(true)
    refused({ ...ok(), mediaIds: ids(21) })
    const accounts = (n: number) => ids(n).map((accountId) => ({ accountId }))
    expect(PostCheckRequest.safeParse({ ...ok(), destinations: accounts(100) }).success).toBe(true)
    refused({ ...ok(), destinations: accounts(101) })
  })

  test('a text over 70,000 characters is refused, in any field', () => {
    const long = 'a'.repeat(POST_CHECK_LIMITS.captionCharacters + 1)
    expect(
      PostCheckRequest.safeParse({ ...ok(), caption: { common: long.slice(1) } }).success,
    ).toBe(true)
    refused({ ...ok(), caption: { common: long } })
    refused({ ...ok(), caption: { common: '', instagram: long } })
    refused({ ...ok(), caption: { common: '', facebook: long } })
    refused({ ...ok(), caption: { common: '', tiktok: 'altro' } })
    // characters are code points, as the rules count them: 70,000 emoji pass, one more does not
    const emoji = '😀'.repeat(POST_CHECK_LIMITS.captionCharacters)
    expect(PostCheckRequest.safeParse({ ...ok(), caption: { common: emoji } }).success).toBe(true)
    refused({ ...ok(), caption: { common: `${emoji}😀` } })
  })

  test('choices: at most 50, of known options, with a key', () => {
    const choice = (i: number) => ({ key: `quota_low:destination:${String(i)}`, option: 'accept' })
    expect(
      PostCheckRequest.safeParse({
        ...ok(),
        choices: Array.from({ length: 50 }, (_, i) => choice(i)),
      }).success,
    ).toBe(true)
    refused({ ...ok(), choices: Array.from({ length: 51 }, (_, i) => choice(i)) })
    refused({ ...ok(), choices: [{ key: 'quota_low:post', option: 'cancel' }] })
    refused({ ...ok(), choices: [{ key: '', option: 'accept' }] })
    refused({ ...ok(), choices: [{ key: 'k'.repeat(301), option: 'accept' }] })
    refused({ ...ok(), choices: [{ key: 'quota_low:post', option: 'accept', extra: true }] })
  })

  test('a date is YYYY-MM-DD and a time HH:MM of the day', () => {
    for (const [localDate, localTime] of [
      ['18/11/2026', '18:00'],
      ['2026-11-18', '24:00'],
      ['2026-11-18', '18:60'],
      ['2026-11-18', '8:00'],
      ['2026-11-18', '18:00:00'],
    ])
      refused({ ...ok(), when: { mode: 'at', localDate, localTime } })
    refused({ ...ok(), when: { mode: 'later' } })
  })

  test('ids are UUIDs, the type one of the four, nothing unknown', () => {
    refused({ ...ok(), mediaIds: ['media-1'] })
    refused({ ...ok(), destinations: [{ accountId: 'acc' }] })
    refused({ ...ok(), type: 'video' })
    refused({ ...ok(), cover: { source: 'image', mediaId: 'x' } })
    refused({ ...ok(), cover: { source: 'frame', offsetMs: -1 } })
    refused({ ...ok(), organizationId: randomUUID() })
  })
})
