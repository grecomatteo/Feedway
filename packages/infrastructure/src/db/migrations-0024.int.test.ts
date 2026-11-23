import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLogger } from '../logging/logger.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../testing/index.js'
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js'

// Migration 0024 on a database left by 0.13 (plan 08 Task 4, D-116): the events waiting for
// more than 6 hours are marked as sent without notifications, the newer ones stay to be sent.

let tdb: TestDatabase
let url: { migrator: string; runtime: string; admin: string }
let folder: string
const [old, oldOfPlatform, recent, sent] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const name = `upgrade_${randomUUID().replaceAll('-', '').slice(0, 12)}`

const inDatabase = (base: string, database: string) => {
  const u = new URL(base)
  u.pathname = `/${database}`
  return u.toString()
}

async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  return withScope(
    url.runtime,
    { kind: 'system' },
    async (c) => (await c.query<T>(text, values)).rows,
  )
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  url = {
    migrator: inDatabase(tdb.migratorUrl, name),
    runtime: inDatabase(tdb.runtimeUrl, name),
    admin: inDatabase(tdb.adminUrl, name),
  }
  // a new database of the cluster with the same rights as roles.sql gives the first one
  const admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  await admin.query(`create database ${name} owner app_migrator`)
  await admin.end()
  const local = new pg.Client({ connectionString: url.admin })
  await local.connect()
  await local.query(`alter schema public owner to app_migrator;
    revoke all on schema public from public;
    grant usage on schema public to app_runtime;
    alter default privileges for role app_migrator in schema public
      grant select, insert, update, delete on tables to app_runtime;
    alter default privileges for role app_migrator in schema public
      grant usage, select on sequences to app_runtime;`)
  await local.end()

  // the migrations of 0.12: the folder with the journal cut before 0019
  folder = await mkdtemp(join(tmpdir(), 'migrations-0023-'))
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  journal.entries = journal.entries.filter((e) => e.idx <= 23)
  expect(journal.entries.at(-1)?.tag).toBe('0023_publishing_slow_down')
  await writeFile(journalPath, JSON.stringify(journal))
  const pool = new pg.Pool({ connectionString: url.migrator, max: 1 })
  await migrate(drizzle(pool), { migrationsFolder: folder })
  await pool.end()

  const org = await seed(url.runtime, (s) => s.organization())
  await withScope(url.runtime, { kind: 'system' }, async (c) => {
    const event = (id: string, organizationId: string | null, age: string) =>
      c.query(
        `insert into outbox_events (id, organization_id, type, payload, created_at)
         values ($1, $2, 'post.target_failed', '{}', now() - $3::interval)`,
        [id, organizationId, age],
      )
    await event(old, org, '7 hours')
    await event(oldOfPlatform, null, '7 hours')
    await event(recent, org, '1 hour')
    await c.query(
      `insert into outbox_events (id, organization_id, type, payload, created_at, dispatched_at)
       values ($1, $2, 'post.confirmed', '{}', now() - interval '3 days', now() - interval '2 days')`,
      [sent, org],
    )
  })

  await runMigrations({
    migratorUrl: url.migrator,
    runtimeRole: 'app_runtime',
    logger: createLogger({ service: 'migrate', level: 'error' }),
  })
}, 180_000)

afterAll(async () => {
  await rm(folder, { recursive: true, force: true })
  await tdb.stop()
})

test('events older than 6 hours are marked as sent, the newer ones stay to be sent (D-116)', async () => {
  const rows = await query<{ id: string; sent: boolean }>(
    'select id, dispatched_at is not null as sent from outbox_events',
  )
  const sentOf = Object.fromEntries(rows.map((r) => [r.id, r.sent]))
  expect(sentOf).toEqual({ [old]: true, [oldOfPlatform]: true, [recent]: false, [sent]: true })
})

test('an event sent before keeps its time', async () => {
  const [row] = await query<{ recent: boolean }>(
    `select dispatched_at < now() - interval '1 day' as recent from outbox_events where id = $1`,
    [sent],
  )
  expect(row?.recent).toBe(true)
})
