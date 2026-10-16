import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLogger } from '../logging/logger.js'
import { startTestDatabase } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { runMigrations } from './migrate.js'

let tdb: TestDatabase
beforeAll(async () => {
  tdb = await startTestDatabase()
}, 120_000)
afterAll(async () => {
  await tdb.stop()
})

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

test('runtime role can read and write settings', async () => {
  await withClient(tdb.runtimeUrl, async (c) => {
    await c.query(`insert into settings(key, value) values ('k', '{"a":1}')`)
    const res = await c.query<{ value: unknown }>(`select value from settings where key='k'`)
    expect(res.rows[0]?.value).toEqual({ a: 1 })
  })
})

test('runtime role cannot create tables', async () => {
  await expect(
    withClient(tdb.runtimeUrl, (c) => c.query('create table x(id int)')),
  ).rejects.toThrow(/permission denied/)
})

test('runtime role can read the queue tables but not create objects there', async () => {
  await withClient(tdb.runtimeUrl, async (c) => {
    const res = await c.query('select count(*) from pgboss.queue')
    expect(res.rowCount).toBe(1)
  })
  await expect(
    withClient(tdb.runtimeUrl, (c) => c.query('create table pgboss.x(id int)')),
  ).rejects.toThrow(/permission denied/)
})

test('migrations are idempotent', async () => {
  await expect(
    runMigrations({
      migratorUrl: tdb.migratorUrl,
      runtimeRole: 'app_runtime',
      logger: createLogger({ service: 'migrate', level: 'error' }),
    }),
  ).resolves.toBeUndefined()
})
