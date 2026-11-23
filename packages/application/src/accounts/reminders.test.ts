import { expect, test } from 'vitest'
import { metaReminderEvent } from './reminders.js'

// The keys of `meta.reminder` (plan 08 Task 4): the same reminder and due date, the same key.

const ORG = '00000000-0000-4000-8000-000000000001'
const CONNECTION = '00000000-0000-4000-8000-000000000002'

test('each reminder is keyed by what it is about and when it is due', () => {
  const rejectedAt = new Date('2026-11-20T10:00:00.000Z')
  expect(metaReminderEvent(ORG, { kind: 'app_rejected' }, rejectedAt)).toEqual({
    payload: { reminder: 'app_rejected' },
    dedupeKey: `${ORG}:app_rejected:2026-11-20T10:00:00.000Z`,
  })
  expect(
    metaReminderEvent(ORG, { kind: 'data_use_checkup', dueOn: '2026-12-10', daysLeft: 17 }, null),
  ).toEqual({
    payload: { reminder: 'data_use_checkup', dueOn: '2026-12-10', daysLeft: 17 },
    dedupeKey: `${ORG}:data_use_checkup:2026-12-10`,
  })
  expect(
    metaReminderEvent(
      ORG,
      { kind: 'token_expiring', connectionId: CONNECTION, expiresAt: rejectedAt },
      null,
    )?.dedupeKey,
  ).toBe(`${CONNECTION}:token_expiring:2026-11-20T10:00:00.000Z`)
})

test('the days left change every day, the key does not', () => {
  const on = (daysLeft: number) =>
    metaReminderEvent(
      ORG,
      { kind: 'graph_version_sunset', version: 'v24.0', dueOn: '2027-01-30', daysLeft },
      null,
    )?.dedupeKey
  expect(on(68)).toBe(on(67))
})

test('a revoked access is told by account.token_invalid, not reminded', () => {
  expect(metaReminderEvent(ORG, { kind: 'access_revoked', connectionId: CONNECTION }, null)).toBe(
    null,
  )
})
