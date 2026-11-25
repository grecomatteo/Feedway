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

// Migration 0031 on a database left by 0030 (Matteo, 25/11): a client without a usual time for
// its posts gets 14:00, one with its own keeps it, and a new client is born with 14:00.

let tdb: TestDatabase
let url: { migrator: string; runtime: string; admin: string }
let folder: string
let org: string
let without: string
let own: string
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

  // the migrations up to 0030: the folder with the journal cut before 0031
  folder = await mkdtemp(join(tmpdir(), 'migrations-0030-'))
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  journal.entries = journal.entries.filter((e) => e.idx <= 30)
  expect(journal.entries.at(-1)?.tag).toBe('0030_plan_due_soon')
  await writeFile(journalPath, JSON.stringify(journal))
  const pool = new pg.Pool({ connectionString: url.migrator, max: 1 })
  await migrate(drizzle(pool), { migrationsFolder: folder })
  await pool.end()

  org = await seed(url.runtime, (s) => s.organization())
  without = await seed(url.runtime, (s) => s.workspace(org, { name: 'Senza orario' }))
  own = await seed(url.runtime, (s) => s.workspace(org, { name: 'Con il suo' }))
  await withScope(url.runtime, { kind: 'system' }, async (c) => {
    await c.query(`update workspaces set default_post_time = null where id = $1`, [without])
    await c.query(`update workspaces set default_post_time = '18:30' where id = $1`, [own])
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

const timeOf = async (id: string) =>
  (
    await query<{ time: string | null }>(
      `select to_char(default_post_time, 'HH24:MI') as time from workspaces where id = $1`,
      [id],
    )
  )[0]?.time

test('a client without a usual time gets 14:00, one with its own keeps it', async () => {
  expect(await timeOf(without)).toBe('14:00')
  expect(await timeOf(own)).toBe('18:30')
})

test('a new client is born with 14:00', async () => {
  const born = await seed(url.runtime, (s) => s.workspace(org, { name: 'Nuovo' }))
  expect(await timeOf(born)).toBe('14:00')
})
