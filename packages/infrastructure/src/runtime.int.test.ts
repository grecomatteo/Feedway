import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createRuntime } from './runtime.js'
import type { RuntimeRole } from './runtime.js'
import { seed, startTestDatabase } from './testing/index.js'
import type { TestDatabase } from './testing/index.js'

let tdb: TestDatabase
let orgA: string, ownerA: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    ownerA = await s.user()
    await s.member(orgA, ownerA, 'owner')
  })
})
afterAll(async () => {
  await tdb.stop()
})

test.each<RuntimeRole>(['web', 'worker'])('the %s runtime wires every service', async (role) => {
  const runtime = await createRuntime(
    { databaseUrl: tdb.runtimeUrl, encryptionKey: randomBytes(32), logLevel: 'error' },
    role,
  )
  try {
    const member = await runtime.uow.run({ organizationId: orgA, userId: ownerA }, (tx) =>
      tx.orgMembers.find(orgA, ownerA),
    )
    expect(member?.role).toBe('owner')
    expect((await runtime.rateLimiter.hit(`runtime:${role}`, 1, 60_000)).allowed).toBe(true)
    const box = runtime.keyRing.platform()
    expect(box.open(box.seal('segreto', 'aad'), 'aad')).toBe('segreto')
    await expect(runtime.queue.ping()).resolves.toBeUndefined()
    expect(runtime.ids.newId()).toMatch(/^[0-9a-f-]{36}$/)
  } finally {
    await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
    await runtime.close()
  }
})

test('a runtime that cannot reach the database fails at start-up', async () => {
  await expect(
    createRuntime(
      {
        databaseUrl: 'postgres://nobody:wrong@127.0.0.1:1/none',
        encryptionKey: randomBytes(32),
        logLevel: 'error',
      },
      'web',
    ),
  ).rejects.toThrow()
})
