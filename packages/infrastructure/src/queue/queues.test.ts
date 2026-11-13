import { expect, test } from 'vitest'
import type { QueueDefinition } from './queues.js'
import { QUEUE_NAMES, QUEUES } from './queues.js'

test('every registered queue declares a scope', () => {
  expect(QUEUES.map((q) => [q.name, q.scope])).toEqual([
    ['system.selftest', 'system'],
    ['identity.security_email', 'user'],
    ['identity.password_reset_email', 'user'],
    ['identity.account_locked_notice', 'system'],
    ['identity.account_locked_notice_email', 'system'],
    ['identity.account_recovery_email', 'user'],
    ['identity.email_change', 'user'],
    ['identity.data_export', 'user'],
    ['identity.retention', 'system'],
    ['identity.anonymization_notice', 'user'],
    ['accounts.sync', 'organization'],
    ['accounts.health', 'organization'],
    ['accounts.daily', 'system'],
    ['accounts.avatar', 'organization'],
  ])
  expect(QUEUE_NAMES).toEqual([
    'system.selftest',
    'identity.security_email',
    'identity.password_reset_email',
    'identity.account_locked_notice',
    'identity.account_locked_notice_email',
    'identity.account_recovery_email',
    'identity.email_change',
    'identity.data_export',
    'identity.retention',
    'identity.anonymization_notice',
    'accounts.sync',
    'accounts.health',
    'accounts.daily',
    'accounts.avatar',
  ])
})

test('the jobs of one connection, or of one account, wait for each other, one waiting at most', () => {
  for (const name of ['accounts.sync', 'accounts.health', 'accounts.avatar'])
    expect(QUEUES.find((q) => q.name === name)?.policy).toBe('stately')
})

test('the daily runs go one at a time', () => {
  for (const name of ['identity.retention', 'accounts.daily'])
    expect(QUEUES.find((q) => q.name === name)?.policy).toBe('singleton')
})

test('a reset link does not stay in the queue tables past its hour', () => {
  expect(QUEUES.find((q) => q.name === 'identity.password_reset_email')?.retention).toEqual({
    retentionSeconds: 3600,
    deleteAfterSeconds: 3600,
  })
})

test('an email change link does not stay in the queue tables past its hour', () => {
  expect(QUEUES.find((q) => q.name === 'identity.email_change')?.retention).toEqual({
    retentionSeconds: 3600,
    deleteAfterSeconds: 3600,
  })
})

test('a recovery link does not stay in the queue tables past its 30 minutes', () => {
  expect(QUEUES.find((q) => q.name === 'identity.account_recovery_email')?.retention).toEqual({
    retentionSeconds: 1800,
    deleteAfterSeconds: 1800,
  })
})

test('a lock notice holds only ids and is kept for a short time', () => {
  expect(QUEUES.find((q) => q.name === 'identity.account_locked_notice')?.retention).toEqual({
    retentionSeconds: 3 * 86_400,
    deleteAfterSeconds: 86_400,
  })
})

test('a queue definition cannot declare a scope other than its payload scope', () => {
  const wrong: QueueDefinition<'system.selftest'> = {
    name: 'system.selftest',
    policy: 'short',
    // @ts-expect-error system.selftest is a system queue, not a user one
    scope: 'user',
  }
  expect(wrong.scope).toBe('user')
})
