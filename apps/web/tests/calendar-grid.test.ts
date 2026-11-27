import { describe, expect, test } from 'vitest'
import {
  gridInstagramAccounts,
  gridSignOf,
  keepGridPictures,
  type GivenPictures,
} from '../app/utils/calendar-grid.ts'

// Instagram's grid in the panel (plan 09 Task 12): which accounts, the sign of a place.

const account = (
  id: string,
  platform: 'instagram' | 'facebook',
  username: string | null = null,
) => ({
  id,
  platform,
  externalId: id,
  name: `Nome ${id}`,
  username,
  avatarUrl: null,
  active: true,
  health: null,
  healthMessage: null,
})

describe('the accounts of the grid', () => {
  const profiles = [
    {
      key: 'a',
      id: 'a',
      accounts: [account('fb1', 'facebook'), account('ig1', 'instagram', 'uno')],
    },
    { key: 'b', id: 'b', accounts: [account('ig2', 'instagram')] },
  ]
  test('only Instagram ones, of the whole client or of the profile of the context', () => {
    expect(gridInstagramAccounts(profiles, null).map((a) => a.id)).toEqual(['ig1', 'ig2'])
    expect(gridInstagramAccounts(profiles, ['fb1', 'ig1']).map((a) => a.id)).toEqual(['ig1'])
    expect(gridInstagramAccounts(profiles, ['fb1'])).toEqual([])
  })
  test('named by the handle, else by the name', () => {
    expect(gridInstagramAccounts(profiles, null).map((a) => a.label)).toEqual(['@uno', 'Nome ig2'])
  })
})

describe('the sign of a place', () => {
  test('a carousel and a reel have one, a photo none', () => {
    expect(gridSignOf({ type: 'carousel' })).toBe('carousel')
    expect(gridSignOf({ type: 'reel' })).toBe('reel')
    expect(gridSignOf({ type: 'photo' })).toBeNull()
    expect(gridSignOf({ kind: 'carousel', reel: false })).toBe('carousel')
    expect(gridSignOf({ kind: 'video', reel: true })).toBe('reel')
    expect(gridSignOf({ kind: 'video', reel: false })).toBe('video')
    expect(gridSignOf({ kind: 'image', reel: false })).toBeNull()
  })
})

describe('the pictures of the posts out, read again', () => {
  const FRESH = 240_000
  const out = (tokens: Record<string, string | null>) =>
    Object.entries(tokens).map(([id, picture]) => ({ id, picture, kind: 'image' }))

  test('a grid read again while fresh keeps the tokens given, so the addresses stay', () => {
    const given = new Map<string, GivenPictures>()
    const first = keepGridPictures(given, 'ig', out({ a: 't1', b: 't2', c: null }), 1000, FRESH)
    expect(first).toEqual({ at: 1000, items: out({ a: 't1', b: 't2', c: null }) })
    // after a swap: new tokens for the same pictures, and a post just out
    const again = keepGridPictures(given, 'ig', out({ d: 't9', a: 't7', b: 't8' }), 61_000, FRESH)
    expect(again).toEqual({ at: 1000, items: out({ d: 't9', a: 't1', b: 't2' }) })
    // another account has its own
    expect(keepGridPictures(given, 'ig2', out({ a: 'x1' }), 62_000, FRESH).items).toEqual(
      out({ a: 'x1' }),
    )
  })

  test('once they may expire, the new tokens are taken, and the time is theirs', () => {
    const given = new Map<string, GivenPictures>()
    keepGridPictures(given, 'ig', out({ a: 't1' }), 1000, FRESH)
    expect(keepGridPictures(given, 'ig', out({ a: 't5' }), 1000 + FRESH, FRESH)).toEqual({
      at: 1000 + FRESH,
      items: out({ a: 't5' }),
    })
  })

  test('posts out that could not be read: nothing to keep, the time still counts', () => {
    const given = new Map<string, GivenPictures>()
    expect(keepGridPictures(given, 'ig', null, 5000, FRESH)).toEqual({ at: 5000, items: null })
  })
})
