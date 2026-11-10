import { expect, test } from 'vitest'
import {
  canTakeOver,
  connectionNeedsRefresh,
  formProfiles,
  isSelectable,
  type ProfileAccount,
} from './accounts.js'

const ig = (id: string, pageId: string | null, over: Partial<ProfileAccount> = {}) => ({
  id,
  platform: 'instagram' as const,
  pageId,
  active: true,
  ...over,
})
const fb = (id: string, over: Partial<ProfileAccount> = {}) => ({
  id,
  platform: 'facebook' as const,
  pageId: `page-${id}`,
  active: true,
  ...over,
})
const ids = (profiles: { accounts: { id: string }[] }[]) =>
  profiles.map((p) => p.accounts.map((a) => a.id))

test('an Instagram account and its Page, both in the workspace, form one profile', () => {
  const page = fb('f1')
  const profiles = formProfiles([page, ig('i1', 'page-f1')])
  expect(ids(profiles)).toEqual([['i1', 'f1']])
  expect(profiles[0]?.key).toBe('page:page-f1')
})

test('an Instagram account whose Page is outside the workspace is a profile of its own', () => {
  // the Page is not in the list: nothing about it can show
  expect(ids(formProfiles([ig('i1', 'page-f9')]))).toEqual([['i1']])
})

test('an Instagram account without a Page is a profile of its own', () => {
  const profiles = formProfiles([ig('i1', null), ig('i2', null)])
  expect(ids(profiles)).toEqual([['i1'], ['i2']])
  expect(profiles.map((p) => p.key)).toEqual(['account:i1', 'account:i2'])
})

test('an inactive account never appears, not even next to its active pair', () => {
  expect(ids(formProfiles([fb('f1', { active: false }), ig('i1', 'page-f1')]))).toEqual([['i1']])
  expect(ids(formProfiles([fb('f1'), ig('i1', 'page-f1', { active: false })]))).toEqual([['f1']])
  expect(formProfiles([ig('i1', null, { active: false })])).toEqual([])
})

test('profiles keep the order of the list, and the same accounts give the same keys', () => {
  const list = [ig('i2', null), fb('f1'), ig('i1', 'page-f1')]
  expect(ids(formProfiles(list))).toEqual([['i2'], ['i1', 'f1']])
  expect(
    formProfiles([...list].reverse())
      .map((p) => p.key)
      .sort(),
  ).toEqual(
    formProfiles(list)
      .map((p) => p.key)
      .sort(),
  )
})

test('a selectable account is active, checked and not red', () => {
  expect(isSelectable({ active: true, health: 'ok' })).toBe(true)
  expect(isSelectable({ active: true, health: 'warning' })).toBe(true)
  expect(isSelectable({ active: true, health: 'error' })).toBe(false)
  // never checked yet: not known to be publishable
  expect(isSelectable({ active: true, health: null })).toBe(false)
  expect(isSelectable({ active: false, health: 'ok' })).toBe(false)
})

const DAY = 86_400_000
const now = new Date('2026-11-10T12:00:00Z')
const at = (ms: number) => new Date(now.getTime() + ms)

test('a connection needs a new token from 7 days before it expires', () => {
  const live = (expiresAt: Date | null) => ({ status: 'active' as const, expiresAt })
  expect(connectionNeedsRefresh(live(at(8 * DAY)), now)).toBe(false)
  expect(connectionNeedsRefresh(live(at(7 * DAY + 1)), now)).toBe(false)
  expect(connectionNeedsRefresh(live(at(7 * DAY)), now)).toBe(true)
  expect(connectionNeedsRefresh(live(at(DAY)), now)).toBe(true)
  // already past its date: still worth one try before it is marked expired
  expect(connectionNeedsRefresh(live(at(-DAY)), now)).toBe(true)
  // a token that never expires (system user) is never refreshed
  expect(connectionNeedsRefresh(live(null), now)).toBe(false)
})

test('only a connection that still works is refreshed', () => {
  const soon = at(DAY)
  expect(connectionNeedsRefresh({ status: 'pending', expiresAt: soon }, now)).toBe(true)
  expect(connectionNeedsRefresh({ status: 'expired', expiresAt: soon }, now)).toBe(false)
  expect(connectionNeedsRefresh({ status: 'revoked', expiresAt: soon }, now)).toBe(false)
})

test('another connection takes an account only from an expired or revoked owner', () => {
  const newcomer = { id: 'c2', status: 'active' as const }
  expect(canTakeOver({ id: 'c1', status: 'active' }, newcomer)).toBe(false)
  expect(canTakeOver({ id: 'c1', status: 'pending' }, newcomer)).toBe(false)
  expect(canTakeOver({ id: 'c1', status: 'expired' }, newcomer)).toBe(true)
  expect(canTakeOver({ id: 'c1', status: 'revoked' }, newcomer)).toBe(true)
})

test('the owner keeps its own account, and a broken newcomer takes nothing', () => {
  expect(canTakeOver({ id: 'c1', status: 'active' }, { id: 'c1', status: 'active' })).toBe(true)
  expect(canTakeOver({ id: 'c1', status: 'expired' }, { id: 'c2', status: 'pending' })).toBe(true)
  expect(canTakeOver({ id: 'c1', status: 'expired' }, { id: 'c2', status: 'expired' })).toBe(false)
  expect(canTakeOver({ id: 'c1', status: 'revoked' }, { id: 'c2', status: 'revoked' })).toBe(false)
})
