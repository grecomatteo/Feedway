import { ALL_PERMISSIONS, OUTBOX_EVENT_TYPES, PLATFORM_PERMISSIONS } from '@app/domain'
import { expect, test } from 'vitest'
import type { QueueName } from './ports/job-queue.js'
import { MODULES, userAnonymizedHandlers } from './modules.js'

// Permissions of modules not written yet (stages 7–8): listed so a new one is never forgotten.
const FUTURE_PERMISSIONS = ['share_link.manage']

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
  'accounts.avatar': true,
  'media.delete_files': true,
  'media.process': true,
  'media.publish_copies': true,
  'media.uploads_cleanup': true,
  'media.publish_copies_cleanup': true,
  'target.prepare': true,
  'target.publish': true,
  'target.reconcile': true,
  'target.verify': true,
  'scheduler.reconcile': true,
  'notify.dispatch': true,
  'notify.deliver': true,
  'notify.deliver_platform': true,
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

test('every outbox event has exactly one kind of notification, from one module', () => {
  const claimed = MODULES.flatMap((m) => m.notificationKinds ?? []).map((k) => k.type)
  expect(new Set(claimed).size).toBe(claimed.length)
  expect([...claimed].sort()).toEqual([...OUTBOX_EVENT_TYPES].sort())
})

test('the anonymization handlers come from the modules, in their order', () => {
  expect(userAnonymizedHandlers()).toEqual(MODULES.flatMap((m) => m.onUserAnonymized ?? []))
})
