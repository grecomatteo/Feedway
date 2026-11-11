import { expect, test } from 'vitest'
import { daysUntil, metaReminders, type MetaRemindersInput } from './reminders.js'

const base: MetaRemindersInput = {
  today: '2027-01-10',
  now: new Date('2027-01-10T09:00:00Z'),
  graphVersion: 'v24.0',
  graphVersionSunset: '2028-07-29',
  dataUseCheckupDueOn: null,
  connections: [],
}

const kinds = (input: Partial<MetaRemindersInput>) =>
  metaReminders({ ...base, ...input }).map((r) => r.kind)

test('counts calendar days, across a leap day', () => {
  expect(daysUntil('2028-02-28', '2028-03-01')).toBe(2)
  expect(daysUntil('2027-02-28', '2027-03-01')).toBe(1)
  expect(daysUntil('2027-01-10', '2027-01-10')).toBe(0)
  expect(daysUntil('2027-01-10', '2027-01-09')).toBe(-1)
})

test('the Graph API version is recalled from 90 days before its retirement', () => {
  // 2028-07-29 minus 90 days, across 2028-02-29
  expect(daysUntil('2028-04-30', '2028-07-29')).toBe(90)
  expect(kinds({ today: '2028-04-29' })).toEqual([])
  expect(metaReminders({ ...base, today: '2028-04-30' })).toEqual([
    { kind: 'graph_version_sunset', version: 'v24.0', dueOn: '2028-07-29', daysLeft: 90 },
  ])
  expect(kinds({ today: '2028-05-01' })).toEqual(['graph_version_sunset'])
})

test('the 90 days count the leap day of the year', () => {
  // 90 days before 2028-05-01 is 2028-02-01 in a leap year, 2027-01-31 would be off by one
  expect(kinds({ graphVersionSunset: '2028-05-01', today: '2028-02-01' })).toEqual([
    'graph_version_sunset',
  ])
  expect(kinds({ graphVersionSunset: '2028-05-01', today: '2028-01-31' })).toEqual([])
})

test('a retired version is still recalled, with the days gone by', () => {
  expect(metaReminders({ ...base, today: '2028-08-01' })[0]).toMatchObject({ daysLeft: -3 })
})

test('the Data Use Checkup is recalled from 30 days before it is due, and after', () => {
  const dueOn = '2027-03-01'
  expect(kinds({ dataUseCheckupDueOn: dueOn, today: '2027-01-29' })).toEqual([])
  expect(metaReminders({ ...base, dataUseCheckupDueOn: dueOn, today: '2027-01-30' })).toEqual([
    { kind: 'data_use_checkup', dueOn, daysLeft: 30 },
  ])
  expect(metaReminders({ ...base, dataUseCheckupDueOn: dueOn, today: '2027-03-02' })).toEqual([
    { kind: 'data_use_checkup', dueOn, daysLeft: -1 },
  ])
})

test('no checkup date (app in development): no reminder', () => {
  expect(
    kinds({ dataUseCheckupDueOn: null, today: '2099-01-01', graphVersionSunset: '2100-01-01' }),
  ).toEqual([])
})

test('a connection whose client took the access back is recalled', () => {
  const connections = [
    { id: 'c1', status: 'revoked' as const, expiresAt: null },
    { id: 'c2', status: 'active' as const, expiresAt: null },
    { id: 'c3', status: 'expired' as const, expiresAt: null },
  ]
  expect(metaReminders({ ...base, connections })).toEqual([
    { kind: 'access_revoked', connectionId: 'c1' },
  ])
})

test('a token that still works and ends within 5 days is recalled, not before', () => {
  const at = (iso: string) => [{ id: 'c1', status: 'active' as const, expiresAt: new Date(iso) }]
  expect(kinds({ connections: at('2027-01-15T09:00:01Z') })).toEqual([])
  expect(metaReminders({ ...base, connections: at('2027-01-15T09:00:00Z') })).toEqual([
    { kind: 'token_expiring', connectionId: 'c1', expiresAt: new Date('2027-01-15T09:00:00Z') },
  ])
  // a connection that no longer works has its own red state, not a reminder
  expect(
    kinds({ connections: [{ id: 'c1', status: 'expired', expiresAt: new Date('2027-01-11') }] }),
  ).toEqual([])
})

test('reminders come in a fixed order: platform first, then connections', () => {
  expect(
    kinds({
      today: '2028-07-01',
      dataUseCheckupDueOn: '2028-07-10',
      connections: [
        { id: 'c1', status: 'revoked', expiresAt: null },
        { id: 'c2', status: 'pending', expiresAt: new Date('2028-07-02T00:00:00Z') },
      ],
      now: new Date('2028-07-01T09:00:00Z'),
    }),
  ).toEqual(['graph_version_sunset', 'data_use_checkup', 'access_revoked', 'token_expiring'])
})
