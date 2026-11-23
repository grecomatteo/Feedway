import {
  DEFAULT_NOTIFICATION_SETTINGS,
  channelsFor,
  recipientsFor,
  type OutboxEventType,
  type RecipientFacts,
} from '@app/domain'
import { expect, test } from 'vitest'
import { MODULES } from './modules.js'

// The registered kinds against the table of plan 08, Scelta 4 (§12.2 read with §10.2), with a
// person who chose nothing.
const facts: RecipientFacts = {
  schedulers: ['ada'],
  workspaceManagers: ['bea'],
  orgAdmins: ['carla'],
  platformAdmins: ['eva'],
}

function deliveries(type: OutboxEventType) {
  const kind = MODULES.flatMap((m) => m.notificationKinds ?? []).find((k) => k.type === type)
  if (!kind) throw new Error(`no kind for ${type}`)
  return Object.fromEntries(
    recipientsFor(kind.recipients, facts).map((recipient) => [
      recipient.userId,
      channelsFor({
        kind,
        recipient,
        pref: null,
        settings: DEFAULT_NOTIFICATION_SETTINGS,
        now: new Date('2026-11-23T10:00:00Z'),
        timeZone: 'Europe/Rome',
      }),
    ]),
  )
}

test('a confirmed destination goes to who scheduled, in the panel', () => {
  expect(deliveries('post.target_confirmed')).toEqual({ ada: ['panel'] })
})

test('a confirmed post goes to who scheduled, in the panel and on Telegram', () => {
  expect(deliveries('post.confirmed')).toEqual({ ada: ['panel', 'telegram'] })
})

test('a failed destination or one with a problem goes to who scheduled and the Managers, everywhere', () => {
  const everywhere = ['panel', 'telegram', 'email']
  expect(deliveries('post.target_failed')).toEqual({ ada: everywhere, bea: everywhere })
  expect(deliveries('post.target_problem')).toEqual({ ada: everywhere, bea: everywhere })
})

test('a file that will not publish goes to who scheduled and the Managers, like an error', () => {
  const everywhere = ['panel', 'telegram', 'email']
  expect(deliveries('post.file_wont_publish')).toEqual({ ada: everywhere, bea: everywhere })
  const kind = MODULES.flatMap((m) => m.notificationKinds ?? []).find(
    (k) => k.type === 'post.file_wont_publish',
  )
  expect(kind?.alwaysEmail).toBe('scheduler')
})

test('a paused destination goes to the Managers, in the panel and on Telegram', () => {
  expect(deliveries('post.paused')).toEqual({ bea: ['panel', 'telegram'] })
})

test('a low Instagram quota goes to who scheduled on that account and the Managers, in the panel', () => {
  expect(deliveries('account.quota_low')).toEqual({ ada: ['panel'], bea: ['panel'] })
})
