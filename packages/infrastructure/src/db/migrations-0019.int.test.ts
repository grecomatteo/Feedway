import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLogger } from '../logging/logger.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../testing/index.js'
import { createDb } from './client.js'
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js'
import { createUnitOfWork } from './unit-of-work.js'

// Migration 0019 on a database left by 0.12 (plan 07 Task 3): the scheduled posts whose time
// has passed go back to draft with an entry of the system (D-77 a, Matteo 20/11), the others
// stay as they are, and the copies of today keep answering from their public token.

let tdb: TestDatabase
let url: { migrator: string; runtime: string; admin: string }
let folder: string
const name = `upgrade_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const TOKEN = 'a'.repeat(32)

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

let org: string, ws: string, user: string, account: string, second: string, mediaId: string
const overdue = randomUUID()
const ahead = randomUUID()
const oldDraft = randomUUID()
const overdueTargets = { scheduled: randomUUID(), cancelled: randomUUID() }
const aheadTarget = randomUUID()

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
  folder = await mkdtemp(join(tmpdir(), 'migrations-0018-'))
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  journal.entries = journal.entries.filter((e) => e.idx <= 18)
  expect(journal.entries.at(-1)?.tag).toBe('0018_posts')
  await writeFile(journalPath, JSON.stringify(journal))
  const pool = new pg.Pool({ connectionString: url.migrator, max: 1 })
  await migrate(drizzle(pool), { migrationsFolder: folder })
  await pool.end()

  ;({ org, ws, user, account, second, mediaId } = await seed(url.runtime, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    const ws = await s.workspace(org)
    return {
      org,
      ws,
      user,
      account: await s.account(org, { workspaceIds: [ws] }),
      second: await s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
      mediaId: await s.media(org, ws, {
        uploadedBy: user,
        kind: 'image',
        variants: [
          {
            purpose: 'ig_feed',
            storageKey: 'org/x/ig_feed.jpg',
            mime: 'image/jpeg',
            sizeBytes: 10,
            publicToken: TOKEN,
          },
        ],
      }),
    }
  }))
  await withScope(url.runtime, { kind: 'system' }, async (c) => {
    const post = (id: string, status: string, at: string) =>
      c.query(
        `insert into posts (id, organization_id, workspace_id, type, status, scheduled_at, options,
                            created_by, scheduled_by, updated_by, version)
         values ($1, $2, $3, 'photo', $4, now() + $5::interval,
                 '{"shareToFeed":true,"choices":[]}', $6, $6, $6, 3)`,
        [id, org, ws, status, at, user],
      )
    const target = (id: string, postId: string, status: string, accountId: string) =>
      c.query(
        `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status,
                                   fingerprint)
         values ($1, $2, $3, $4, $5, $6, repeat('a', 64))`,
        [id, org, ws, postId, accountId, status],
      )
    await post(overdue, 'scheduled', '-2 hours')
    await post(ahead, 'scheduled', '2 hours')
    await post(oldDraft, 'draft', '-3 days')
    await target(overdueTargets.scheduled, overdue, 'scheduled', account)
    await target(overdueTargets.cancelled, overdue, 'cancelled', second)
    await target(aheadTarget, ahead, 'scheduled', account)
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

test('a scheduled post whose time has passed goes back to draft, as «Riporta in bozza» (D-77 a)', async () => {
  const [post] = await query<{ status: string; version: number; updated_by: string }>(
    'select status, version, updated_by from posts where id = $1',
    [overdue],
  )
  expect(post).toEqual({ status: 'draft', version: 4, updated_by: user })
  const targets = await query<{ id: string; status: string; fingerprint: string | null }>(
    'select id, status, fingerprint from post_targets where post_id = $1 order by status',
    [overdue],
  )
  expect(targets).toEqual([
    // a destination cancelled before stays so
    { id: overdueTargets.cancelled, status: 'cancelled', fingerprint: 'a'.repeat(64) },
    { id: overdueTargets.scheduled, status: 'draft', fingerprint: null },
  ])
})

test('the change is in the log, of the system and of no person', async () => {
  const entries = await query<{
    id: string
    organization_id: string
    actor_id: string | null
    source: string
    entity: string
    entity_id: string
    workspace_id: string
    data: unknown
  }>(
    `select id, organization_id, actor_id, source, entity, entity_id, workspace_id, data
     from audit_log where action = 'post.unscheduled'`,
  )
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    organization_id: org,
    actor_id: null,
    source: 'system',
    entity: 'post',
    entity_id: overdue,
    workspace_id: ws,
    data: { reason: 'overdue' },
  })
  // the ids of the project are UUID v7
  expect(entries[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/)
})

test('a post still ahead and a draft stay as they are', async () => {
  const rows = await query<{ id: string; status: string; version: number }>(
    'select id, status, version from posts where id = any($1) order by status',
    [[ahead, oldDraft]],
  )
  expect(rows).toEqual([
    { id: oldDraft, status: 'draft', version: 3 },
    { id: ahead, status: 'scheduled', version: 3 },
  ])
  const [target] = await query<{ status: string; generation: number }>(
    'select status, generation from post_targets where id = $1',
    [aheadTarget],
  )
  expect(target).toEqual({ status: 'scheduled', generation: 0 })
})

test('the destination still ahead gets the times of the worker (0022, 0023): it is not forgotten', async () => {
  // the backfills run under row level security forced on the owner: without the system scope
  // they would change no row, and the post would never be prepared (review of stage 7, R1)
  const [target] = await query<{ next_attempt_at: Date | null; recheck_at: Date | null }>(
    'select next_attempt_at, recheck_at from post_targets where id = $1',
    [aheadTarget],
  )
  const [post] = await query<{ scheduled_at: Date }>(
    'select scheduled_at from posts where id = $1',
    [ahead],
  )
  if (!target || !post) throw new Error('rows missing')
  expect(target.next_attempt_at?.getTime()).toBe(post.scheduled_at.getTime() - 15 * 60_000)
  // two hours ahead: fewer than three are left, so the check is due at once
  expect(target.recheck_at).not.toBeNull()
  expect(target.recheck_at?.getTime()).toBeLessThanOrEqual(Date.now())
})

test('the system scope of the migration does not outlive it', async () => {
  const c = new pg.Client({ connectionString: url.runtime })
  await c.connect()
  try {
    const { rows } = await c.query<{ scope: string | null }>(
      `select current_setting('app.scope', true) as scope`,
    )
    expect(rows[0]?.scope ?? '').toBe('')
    expect((await c.query('select id from posts')).rowCount).toBe(0)
  } finally {
    await c.end()
  }
})

test('the copies of today have no recipe, are ready and answer from their public token', async () => {
  const [variant] = await query<{ recipe: string; status: string; failure: string | null }>(
    'select recipe, status, failure from media_variants where media_id = $1',
    [mediaId],
  )
  expect(variant).toEqual({ recipe: '', status: 'ready', failure: null })
  const handle = createDb(url.runtime, { max: 1, applicationName: 'upgrade' })
  try {
    const uow = createUnitOfWork({
      db: handle.db,
      ids: uuidV7Generator,
      logger: createLogger({ service: 'web', level: 'error' }),
    })
    const found = await uow.runAsSystem('test', (tx) => tx.media.findPublicVariant(TOKEN))
    expect(found).toMatchObject({ organizationId: org, storageKey: 'org/x/ig_feed.jpg' })
  } finally {
    await handle.close()
  }
})

test('a copy with a recipe sits beside the one of its purpose, and is served only when ready', async () => {
  const handle = createDb(url.runtime, { max: 1, applicationName: 'upgrade' })
  const pendingToken = 'p'.repeat(32)
  try {
    const uow = createUnitOfWork({
      db: handle.db,
      ids: uuidV7Generator,
      logger: createLogger({ service: 'web', level: 'error' }),
    })
    await uow.run({ organizationId: org, userId: null }, (tx) =>
      tx.media.saveVariant(org, mediaId, {
        id: uuidV7Generator.newId(),
        purpose: 'ig_feed',
        recipe: 'c0ffee',
        storageKey: 'org/x/ig_feed-c0ffee.jpg',
        publicToken: 'r'.repeat(32),
        mime: 'image/jpeg',
        sizeBytes: 20,
        width: 1080,
        height: 1350,
      }),
    )
    const variants = await uow.run({ organizationId: org, userId: null }, (tx) =>
      tx.media.variantsOf(org, [mediaId]),
    )
    // the panel's reads keep seeing one copy per purpose
    expect(variants.map((v) => v.storageKey)).toEqual(['org/x/ig_feed.jpg'])
    expect(
      await uow.runAsSystem('test', (tx) => tx.media.findPublicVariant('r'.repeat(32))),
    ).toMatchObject({ storageKey: 'org/x/ig_feed-c0ffee.jpg' })

    // a copy still to be made has no file behind its token yet
    await query(
      `insert into media_variants (id, organization_id, media_id, purpose, storage_key,
                                   public_token, mime, size_bytes, recipe, status)
       values ($1, $2, $3, 'story', 'org/x/story-beef.jpg', $4, 'image/jpeg', 0, 'beef',
               'pending')`,
      [randomUUID(), org, mediaId, pendingToken],
    )
    expect(
      await uow.runAsSystem('test', (tx) => tx.media.findPublicVariant(pendingToken)),
    ).toBeNull()
  } finally {
    await handle.close()
  }
})
