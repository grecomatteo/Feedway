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
    ['media.delete_files', 'organization'],
    ['media.process', 'organization'],
    ['media.publish_copies', 'organization'],
    ['media.uploads_cleanup', 'system'],
    ['media.publish_copies_cleanup', 'system'],
    ['target.prepare', 'organization'],
    ['target.publish', 'organization'],
    ['target.reconcile', 'organization'],
    ['target.verify', 'organization'],
    ['scheduler.reconcile', 'system'],
    ['notify.dispatch', 'system'],
    ['notify.deliver', 'organization'],
    ['notify.deliver_platform', 'system'],
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
    'media.delete_files',
    'media.process',
    'media.publish_copies',
    'media.uploads_cleanup',
    'media.publish_copies_cleanup',
    'target.prepare',
    'target.publish',
    'target.reconcile',
    'target.verify',
    'scheduler.reconcile',
    'notify.dispatch',
    'notify.deliver',
    'notify.deliver_platform',
  ])
})

test('the dispatcher has one run queued and one running at most (plan 08 P2)', () => {
  expect(QUEUES.find((q) => q.name === 'notify.dispatch')?.policy).toBe('stately')
})

test('a step of the publishing is aborted before its preparation claim expires', () => {
  for (const name of ['target.prepare', 'target.publish', 'target.reconcile', 'target.verify'])
    expect(QUEUES.find((q) => q.name === name)?.expireInSeconds).toBe(300)
  expect(QUEUES.find((q) => q.name === 'scheduler.reconcile')?.policy).toBe('singleton')
  expect(QUEUES.find((q) => q.name === 'media.publish_copies_cleanup')?.policy).toBe('singleton')
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

test('media.process outlives its two long ffmpeg commands (ADR 021)', () => {
  expect(QUEUES.find((q) => q.name === 'media.process')?.expireInSeconds).toBe(2 * 3600 + 15 * 60)
  // a copy to publish converts a whole video once at most
  expect(QUEUES.find((q) => q.name === 'media.publish_copies')?.expireInSeconds).toBe(
    2 * 3600 + 15 * 60,
  )
})
