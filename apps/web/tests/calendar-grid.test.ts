import { describe, expect, test } from 'vitest'
import { gridInstagramAccounts, gridSignOf } from '../app/utils/calendar-grid.ts'

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
