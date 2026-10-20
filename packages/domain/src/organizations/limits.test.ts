import { expect, test } from 'vitest'
import { checkLimit, parseLimits } from './limits.js'

test('missing key is unlimited', () => {
  expect(checkLimit({}, 'workspaces', 999)).toEqual({ ok: true })
  expect(checkLimit({ users: 1 }, 'workspaces', 999)).toEqual({ ok: true })
})

test('reaching the limit blocks the next one', () => {
  expect(checkLimit({ workspaces: 3 }, 'workspaces', 2)).toEqual({ ok: true })
  expect(checkLimit({ workspaces: 3 }, 'workspaces', 3)).toEqual({ ok: false, limit: 3 })
})

test('adding more than one counts the whole amount', () => {
  const limits = { storage_bytes: 1000 }
  expect(checkLimit(limits, 'storage_bytes', 400, 600)).toEqual({ ok: true })
  expect(checkLimit(limits, 'storage_bytes', 400, 601)).toEqual({ ok: false, limit: 1000 })
})

test('a zero limit blocks everything', () => {
  expect(checkLimit({ social_accounts: 0 }, 'social_accounts', 0)).toEqual({ ok: false, limit: 0 })
})

test('stored limits keep whole non-negative numbers of known keys', () => {
  expect(parseLimits({ users: 5, workspaces: 0, other: 3 })).toEqual({ users: 5, workspaces: 0 })
  expect(parseLimits({})).toEqual({})
})

test('an unreadable stored limit counts as zero: it closes, never opens', () => {
  expect(
    parseLimits({ users: '5', workspaces: -1, posts_per_day: 1.5, storage_bytes: null }),
  ).toEqual({ users: 0, workspaces: 0, posts_per_day: 0, storage_bytes: 0 })
})
