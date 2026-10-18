import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDatabase } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'

const PERSONAL_TABLES = [
  'users',
  'sessions',
  'accounts',
  'verifications',
  'two_factors',
  'passkeys',
  'rate_limits',
  'known_devices',
  'data_exports',
]

let tdb: TestDatabase
let migrator: pg.Pool
beforeAll(async () => {
  tdb = await startTestDatabase()
  migrator = new pg.Pool({ connectionString: tdb.migratorUrl, max: 2 })
}, 120_000)
afterAll(async () => {
  await migrator.end()
  await tdb.stop()
})

async function insertUser(fields: { email?: string; platformRole?: string } = {}) {
  const id = randomUUID()
  await migrator.query(
    'insert into users (id, name, email, platform_role) values ($1, $2, $3, $4)',
    [id, 'Mario Rossi', fields.email ?? `${id}@esempio.it`, fields.platformRole ?? null],
  )
  return id
}

async function insertSession(fields: { authMethod?: string } = {}) {
  const userId = await insertUser()
  await migrator.query(
    `insert into sessions (id, token, user_id, expires_at, updated_at, auth_method)
     values ($1, $2, $3, now() + interval '1 day', now(), $4)`,
    [randomUUID(), randomUUID(), userId, fields.authMethod ?? 'password'],
  )
}

async function hasColumn(table: string, column: string) {
  const { rowCount } = await migrator.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  )
  return rowCount === 1
}

async function rlsEnabled(table: string) {
  const { rows } = await migrator.query<{ relrowsecurity: boolean }>(
    `select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`,
    [table],
  )
  return rows[0]?.relrowsecurity
}

async function asRuntime<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: tdb.runtimeUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

test('email uniqueness is case-insensitive', async () => {
  await insertUser({ email: 'Mario@Esempio.it' })
  await expect(insertUser({ email: 'mario@esempio.it' })).rejects.toThrow(/unique/)
})

test('enums are enforced', async () => {
  await expect(insertUser({ platformRole: 'superadmin' })).rejects.toThrow(/check/)
  await expect(insertSession({ authMethod: 'magic' })).rejects.toThrow(/check/)
  await expect(insertSession({ authMethod: 'passkey' })).resolves.toBeUndefined()
})

test('deleting a user removes their sessions and devices', async () => {
  const userId = await insertUser()
  await migrator.query(
    `insert into sessions (id, token, user_id, expires_at, updated_at)
     values ($1, $2, $3, now() + interval '1 day', now())`,
    [randomUUID(), randomUUID(), userId],
  )
  await migrator.query(`insert into known_devices (user_id, device_hash) values ($1, '\\x01')`, [
    userId,
  ])
  await migrator.query('delete from users where id = $1', [userId])
  for (const table of ['sessions', 'known_devices']) {
    const { rowCount } = await migrator.query(`select 1 from ${table} where user_id = $1`, [userId])
    expect(rowCount, table).toBe(0)
  }
})

test('personal tables carry no organization column and no row level security', async () => {
  for (const t of PERSONAL_TABLES) {
    expect(await hasColumn(t, 'organization_id'), t).toBe(false)
    expect(await rlsEnabled(t), t).toBe(false)
  }
})

test('runtime role can write identity tables but cannot alter them', async () => {
  await asRuntime(async (c) => {
    await c.query(`insert into users (id, name, email) values ($1, 'Anna', $2)`, [
      randomUUID(),
      `${randomUUID()}@esempio.it`,
    ])
  })
  await expect(asRuntime((c) => c.query('alter table users add column x int'))).rejects.toThrow(
    /must be owner|permission denied/,
  )
})
