import { describe, expect, test } from 'vitest'
import { deletionBlock } from './deletion.js'
import { compareUses, primaryUse, type MediaUse } from './usage.js'

const day = (iso: string) => new Date(`${iso}T10:00:00Z`)

function use(postId: string, status: MediaUse['status'], extra: Partial<MediaUse> = {}): MediaUse {
  return {
    postId,
    status,
    scheduledAt: null,
    timezone: 'Europe/Rome',
    updatedAt: day('2026-11-01'),
    ...extra,
  }
}

const scheduledSoon = use('p3', 'scheduled', { scheduledAt: day('2026-11-20') })
const scheduledLater = use('p1', 'scheduled', { scheduledAt: day('2026-11-27') })
const draftOld = use('p0', 'draft', { updatedAt: day('2026-11-02') })
const draftNew = use('p9', 'draft', {
  updatedAt: day('2026-11-18'),
  // a draft with a date chosen is still a draft: its date does not count
  scheduledAt: day('2026-11-19'),
})
const cancelled = use('p2', 'cancelled', { updatedAt: day('2026-11-19') })

/** Every order of the list: the answer may not depend on how the rows came. */
function orders<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, i) =>
    orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  )
}

describe('the use that counts (D-80.7)', () => {
  test('nothing uses the file: none', () => {
    expect(primaryUse([])).toBeNull()
  })

  test('scheduled, then draft, then cancelled, whatever the order of the rows', () => {
    for (const rows of orders([cancelled, draftNew, scheduledLater]))
      expect(primaryUse(rows)).toBe(scheduledLater)
    for (const rows of orders([cancelled, draftOld])) expect(primaryUse(rows)).toBe(draftOld)
    expect(primaryUse([cancelled])).toBe(cancelled)
  })

  test('two scheduled: the nearest date', () => {
    for (const rows of orders([scheduledLater, scheduledSoon, draftNew]))
      expect(primaryUse(rows)).toBe(scheduledSoon)
  })

  test('two drafts: the one changed last', () => {
    for (const rows of orders([draftOld, draftNew, cancelled]))
      expect(primaryUse(rows)).toBe(draftNew)
  })

  test('even: the post id decides', () => {
    const a = use('a', 'draft')
    const b = use('b', 'draft')
    for (const rows of orders([b, a])) expect(primaryUse(rows)).toBe(a)
    const c = use('c', 'cancelled')
    const d = use('d', 'cancelled')
    for (const rows of orders([d, c])) expect(primaryUse(rows)).toBe(c)
  })

  test('a scheduled post without a date comes after the dated ones', () => {
    const undated = use('a', 'scheduled')
    for (const rows of orders([undated, scheduledLater]))
      expect(primaryUse(rows)).toBe(scheduledLater)
  })

  test('the order is total: sorting gives one list whatever the start', () => {
    const all = [cancelled, draftNew, scheduledLater, draftOld, scheduledSoon]
    const expected = [scheduledSoon, scheduledLater, draftNew, draftOld, cancelled]
    for (const rows of orders(all)) expect([...rows].sort(compareUses)).toEqual(expected)
  })
})

describe('the posts of the publishing (plan 07 Scelta 5)', () => {
  const going = use('g', 'publishing', { scheduledAt: day('2026-11-19') })
  const paused = use('h', 'paused', { scheduledAt: day('2026-11-21') })
  const outOld = use('o1', 'published', { scheduledAt: day('2026-11-10') })
  const outNew = use('o2', 'partial', { scheduledAt: day('2026-11-15') })
  const notOut = use('n', 'failed', { updatedAt: day('2026-11-19') })

  test('a post on its way or paused is still going out: with the scheduled ones, by date', () => {
    for (const rows of orders([scheduledSoon, going, paused, draftNew]))
      expect([...rows].sort(compareUses)).toEqual([going, scheduledSoon, paused, draftNew])
  })

  test('after the drafts the posts that went out, the latest first; then the rest', () => {
    const all = [notOut, outOld, draftNew, cancelled, outNew]
    for (const rows of orders(all))
      expect([...rows].sort(compareUses)).toEqual([draftNew, outNew, outOld, notOut, cancelled])
  })

  test('a file in a post on its way or paused is not deleted', () => {
    expect(deletionBlock([outNew, going])).toMatchObject({ postId: 'g', count: 1 })
    expect(deletionBlock([paused, scheduledLater])).toMatchObject({ postId: 'h', count: 2 })
    expect(deletionBlock([outNew, outOld, notOut])).toBeNull()
  })
})

describe('when a file is not deleted (D-18, D-80.4)', () => {
  test('a file in no scheduled post is deleted', () => {
    expect(deletionBlock([])).toBeNull()
    expect(deletionBlock([draftNew, cancelled])).toBeNull()
  })

  test('a file in a scheduled post is not, with the nearest post', () => {
    expect(deletionBlock([draftNew, scheduledLater, cancelled])).toEqual({
      reason: 'in_scheduled_post',
      postId: 'p1',
      scheduledAt: day('2026-11-27'),
      timezone: 'Europe/Rome',
      count: 1,
    })
  })

  test('two scheduled posts: the nearest, and how many', () => {
    for (const rows of orders([scheduledLater, draftOld, scheduledSoon]))
      expect(deletionBlock(rows)).toEqual({
        reason: 'in_scheduled_post',
        postId: 'p3',
        scheduledAt: day('2026-11-20'),
        timezone: 'Europe/Rome',
        count: 2,
      })
  })

  test('a post that uses the file twice (as a file and as a cover) counts once', () => {
    expect(deletionBlock([scheduledSoon, { ...scheduledSoon }])?.count).toBe(1)
  })
})
