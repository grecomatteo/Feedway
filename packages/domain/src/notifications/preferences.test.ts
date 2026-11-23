import { expect, test } from 'vitest'
import type { NotificationKindRule } from './kinds.js'
import { DEFAULT_NOTIFICATION_SETTINGS, channelsFor, type ChannelsInput } from './preferences.js'

const ROME = 'Europe/Rome'
const DAY = new Date('2026-11-23T10:00:00Z')
// 23:30 in Rome
const NIGHT = new Date('2026-11-23T22:30:00Z')
const quiet = { ...DEFAULT_NOTIFICATION_SETTINGS, quietHours: { start: '22:00', end: '07:00' } }

const failed: NotificationKindRule = {
  type: 'post.target_failed',
  level: 'error',
  recipients: ['scheduler', 'workspace_managers'],
  defaultChannels: ['panel', 'telegram', 'email'],
}
const confirmed: NotificationKindRule = {
  type: 'post.confirmed',
  level: 'success',
  recipients: ['scheduler'],
  defaultChannels: ['panel', 'telegram'],
}
const wontPublish: NotificationKindRule = {
  type: 'post.file_wont_publish',
  level: 'error',
  recipients: ['scheduler', 'workspace_managers'],
  defaultChannels: ['panel', 'telegram', 'email'],
  alwaysEmail: 'scheduler',
}

const input = (over: Partial<ChannelsInput>): ChannelsInput => ({
  kind: confirmed,
  recipient: { userId: 'ada', as: ['scheduler'] },
  pref: null,
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  now: DAY,
  timeZone: ROME,
  ...over,
})

test('without a choice of the person, the kind’s default channels', () => {
  expect(channelsFor(input({}))).toEqual(['panel', 'telegram'])
})

test('the person’s channels for a kind replace the defaults; none turns the kind off', () => {
  expect(channelsFor(input({ pref: { channels: ['email', 'panel'] } }))).toEqual(['panel', 'email'])
  expect(channelsFor(input({ pref: { channels: [] } }))).toEqual([])
})

test('below the minimum level only the panel is left', () => {
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, minLevel: 'warning' as const }
  expect(channelsFor(input({ settings }))).toEqual(['panel'])
  expect(channelsFor(input({ kind: failed, settings }))).toEqual(['panel', 'telegram', 'email'])
})

test('in quiet hours an error still goes everywhere, a success stays in the panel', () => {
  expect(channelsFor(input({ kind: failed, settings: quiet, now: NIGHT }))).toEqual([
    'panel',
    'telegram',
    'email',
  ])
  expect(channelsFor(input({ settings: quiet, now: NIGHT }))).toEqual(['panel'])
  expect(channelsFor(input({ settings: quiet, now: DAY }))).toEqual(['panel', 'telegram'])
})

test('«everything everywhere» sends every kind on every channel', () => {
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, everythingEverywhere: true }
  expect(channelsFor(input({ settings, pref: { channels: [] } }))).toEqual([
    'panel',
    'telegram',
    'email',
  ])
})

test('D-74: who scheduled gets the email of a file that will not publish, even with email off', () => {
  const pref = { channels: [] }
  expect(channelsFor(input({ kind: wontPublish, pref }))).toEqual(['email'])
  const manager = { userId: 'bea', as: ['workspace_managers'] as const }
  expect(channelsFor(input({ kind: wontPublish, pref, recipient: manager }))).toEqual([])
})
