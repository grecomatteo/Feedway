import { ALL_PERMISSIONS, PLATFORM_PERMISSIONS } from '@app/domain'
import { expect, test } from 'vitest'
import type { QueueName } from './ports/job-queue.js'
import { MODULES, userAnonymizedHandlers } from './modules.js'

// Permissions of modules not written yet (stages 3–7): listed so a new one is never forgotten.
const FUTURE_PERMISSIONS = [
  'media.upload',
  'post.draft',
  'post.publish',
  'post.manage_others',
  'post.retry',
  'share_link.manage',
]

// Every queue: the Record type fails to compile when a queue is added without an entry here.
const ALL_QUEUES: Record<QueueName, true> = {
  'system.selftest': true,
  'identity.security_email': true,
  'identity.password_reset_email': true,
  'identity.account_locked_notice': true,
  'identity.account_locked_notice_email': true,
  'identity.account_recovery_email': true,
  'identity.email_change': true,
  'identity.data_export': true,
  'identity.retention': true,
  'identity.anonymization_notice': true,
  'accounts.sync': true,
  'accounts.health': true,
  'accounts.daily': true,
}

test('each module has its own name', () => {
  const names = MODULES.map((m) => m.name)
  expect(new Set(names).size).toBe(names.length)
})

test('every permission belongs to exactly one module, or to a module still to come', () => {
  const claimed = MODULES.flatMap((m) => m.permissions)
  expect(new Set(claimed).size).toBe(claimed.length)
  expect([...claimed, ...FUTURE_PERMISSIONS].sort()).toEqual(
    [...ALL_PERMISSIONS, ...PLATFORM_PERMISSIONS].sort(),
  )
})

test('every queue belongs to exactly one module', () => {
  const claimed = MODULES.flatMap((m) => m.queues)
  expect(new Set(claimed).size).toBe(claimed.length)
  expect([...claimed].sort()).toEqual(Object.keys(ALL_QUEUES).sort())
})

test('the anonymization handlers come from the modules, in their order', () => {
  expect(userAnonymizedHandlers()).toEqual(MODULES.flatMap((m) => m.onUserAnonymized ?? []))
})
