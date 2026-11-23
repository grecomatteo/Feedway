import { expect, test } from 'vitest'
import { GROUP_LIST_MAX, groupListing, groupWindow, inGroupWindow } from './grouping.js'

const first = new Date('2026-11-23T17:00:00Z')

test('a group is sent 60 seconds after its first notification', () => {
  expect(groupWindow(first)).toEqual(new Date('2026-11-23T17:01:00Z'))
})

test('a notification at second 59 joins the group, one at second 61 does not', () => {
  expect(inGroupWindow(first, new Date('2026-11-23T17:00:59Z'))).toBe(true)
  expect(inGroupWindow(first, new Date('2026-11-23T17:01:01Z'))).toBe(false)
})

test('a grouped message lists up to 10 and counts the others', () => {
  const items = Array.from({ length: 13 }, (_, i) => i)
  expect(groupListing(items)).toEqual({ shown: items.slice(0, GROUP_LIST_MAX), more: 3 })
  expect(groupListing([1, 2])).toEqual({ shown: [1, 2], more: 0 })
})
