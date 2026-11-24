import { expect, test } from 'vitest'
import { NotificationChannel, NotificationKindName, NotificationLevel } from '@app/contracts'
import { CHANNELS, LEVELS, OUTBOX_EVENT_TYPES } from '@app/domain'
import { deliveryLines, notificationIcon, notificationTime } from '../app/utils/notifications.ts'
import { message, translate } from './rules-table.ts'

// The centre's small rules (plan 08 Task 6): the lists of the contract are the domain's, every
// kind has an icon and a name, the time says the hour today and the day before.

test('the contract lists the kinds, levels and channels of the domain', () => {
  expect([...NotificationKindName.options].sort()).toEqual([...OUTBOX_EVENT_TYPES].sort())
  expect(NotificationLevel.options).toEqual([...LEVELS])
  expect(NotificationChannel.options).toEqual([...CHANNELS])
})

test('every kind has an icon and a name in the panel', () => {
  for (const kind of NotificationKindName.options) {
    expect(notificationIcon(kind), kind).toMatch(/^i-lucide-/)
    expect(typeof message(`notifications.kinds.${kind.replace('.', '_')}`), kind).toBe('string')
  }
})

test('the time is the hour today, the day before', () => {
  const at = { now: new Date('2026-11-19T15:00:00+01:00'), timeZone: 'Europe/Rome' }
  expect(notificationTime('2026-11-19T09:31:00+01:00', at)).toBe('09:31')
  expect(notificationTime('2026-11-18T09:31:00+01:00', at)).toBe('ieri')
  expect(notificationTime('2026-11-16T09:31:00+01:00', at)).toBe('lun 16 nov')
})

test('the deliveries outside the panel are said, the skipped with their reason', () => {
  const lines = deliveryLines(
    {
      deliveries: [
        { channel: 'panel', status: 'sent', error: null, sentAt: null },
        { channel: 'telegram', status: 'skipped', error: 'Telegram non collegato', sentAt: null },
        { channel: 'email', status: 'sent', error: null, sentAt: null },
      ],
    },
    translate,
  )
  expect(lines).toEqual(['Telegram non collegato', 'Email mandata'])
  expect(
    deliveryLines(
      {
        deliveries: [
          { channel: 'email', status: 'failed', error: 'Il server non risponde', sentAt: null },
        ],
      },
      translate,
    ),
  ).toEqual(['Email non mandata: Il server non risponde'])
})
