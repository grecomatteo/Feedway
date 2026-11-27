import { expect, test } from 'vitest'
import {
  DRAFT_RETENTION_DEFAULT,
  autoTrashAt,
  isDraftRetention,
  trashPurgeAt,
  showsAutoTrash,
  daysUntilAutoTrash,
} from './trash.js'

const DAY = 86_400_000

test('a forgotten draft goes to «Eliminati» after the days of its client (plan 09 Scelta 12)', () => {
  const updatedAt = new Date('2027-01-01T10:00:00Z')
  expect(autoTrashAt(updatedAt, 30)).toEqual(new Date(updatedAt.getTime() + 30 * DAY))
  expect(autoTrashAt(updatedAt, 90)).toEqual(new Date(updatedAt.getTime() + 90 * DAY))
  // «Mai»
  expect(autoTrashAt(updatedAt, null)).toBeNull()
  expect(DRAFT_RETENTION_DEFAULT).toBe(30)
})

test('only 30, 60, 90 days or «Mai» are a choice', () => {
  for (const ok of [30, 60, 90, null]) expect(isDraftRetention(ok)).toBe(true)
  for (const no of [0, 7, 31, 120, -30, 30.5, '30', undefined])
    expect(isDraftRetention(no)).toBe(false)
})

test('«Eliminati» empty themselves 30 days after the post went there', () => {
  const trashedAt = new Date('2027-01-01T10:00:00Z')
  expect(trashPurgeAt(trashedAt)).toEqual(new Date(trashedAt.getTime() + 30 * DAY))
})

test('the list says «Va negli Eliminati tra N giorni» from 7 days before', () => {
  const now = new Date('2027-02-01T10:00:00Z')
  const at = (days: number) => new Date(now.getTime() + days * DAY)
  expect(showsAutoTrash(at(7), now)).toBe(true)
  expect(showsAutoTrash(at(8), now)).toBe(false)
  expect(showsAutoTrash(null, now)).toBe(false)
  // the night has not passed yet
  expect(showsAutoTrash(at(-0.1), now)).toBe(true)
  expect(daysUntilAutoTrash(at(5), now)).toBe(5)
  expect(daysUntilAutoTrash(at(4.2), now)).toBe(5)
  expect(daysUntilAutoTrash(at(0.3), now)).toBe(1)
  expect(daysUntilAutoTrash(at(-1), now)).toBe(0)
})
