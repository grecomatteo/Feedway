import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createDb, type DbHandle } from './client.js'
import { createAdvisoryLock } from './advisory-lock.js'

let tdb: TestDatabase
let one: DbHandle
let two: DbHandle

beforeAll(async () => {
  tdb = await startTestDatabase()
  // two pools, as two worker processes
  one = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'worker-1' })
  two = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'worker-2' })
}, 120_000)

afterAll(async () => {
  await one.close()
  await two.close()
  await tdb.stop()
})

test('one holder at a time across processes, free again afterwards', async () => {
  const a = createAdvisoryLock(one.pool)
  const b = createAdvisoryLock(two.pool)
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const running = new Promise<void>((resolve) => (started = resolve))
  const first = a.tryRun('test', async () => {
    started()
    await held
    return 'first'
  })
  // only once the first holds it: a try from the second before then could win the lock itself
  await running
  await expect(b.tryRun('test', () => Promise.resolve('second'))).resolves.toEqual({
    acquired: false,
  })
  release()
  await expect(first).resolves.toEqual({ acquired: true, value: 'first' })
  await expect(b.tryRun('test', () => Promise.resolve('second'))).resolves.toEqual({
    acquired: true,
    value: 'second',
  })
})

test('the lock is given back when the work throws', async () => {
  const a = createAdvisoryLock(one.pool)
  await expect(a.tryRun('boom', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  await expect(
    createAdvisoryLock(two.pool).tryRun('boom', () => Promise.resolve(1)),
  ).resolves.toEqual({ acquired: true, value: 1 })
})

test('locks of different names do not wait for each other', async () => {
  const a = createAdvisoryLock(one.pool)
  const b = createAdvisoryLock(two.pool)
  const result = await a.tryRun('x', () => b.tryRun('y', () => Promise.resolve('both')))
  expect(result).toEqual({ acquired: true, value: { acquired: true, value: 'both' } })
})
