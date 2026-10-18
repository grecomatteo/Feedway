import { expectTypeOf, test } from 'vitest'
import type { JobPayloads, QueueScopes, ScopedPayload } from './job-queue.js'

test('an organization job cannot be sent without organizationId', () => {
  type Payload = ScopedPayload<'organization', { postId: string }>
  expectTypeOf<Payload>().toHaveProperty('organizationId').toEqualTypeOf<string>()
  expectTypeOf<{ postId: string }>().not.toExtend<Payload>()
  expectTypeOf<{ postId: string; organizationId: string }>().toExtend<Payload>()
})

test('a user job cannot be sent without userId', () => {
  type Payload = ScopedPayload<'user', { exportId: string }>
  expectTypeOf<Payload>().toHaveProperty('userId').toEqualTypeOf<string>()
  expectTypeOf<{ exportId: string }>().not.toExtend<Payload>()
})

test('system.selftest is a system job', () => {
  expectTypeOf<QueueScopes['system.selftest']>().toEqualTypeOf<'system'>()
  expectTypeOf<{ requestedAt: string }>().toExtend<JobPayloads['system.selftest']>()
})
