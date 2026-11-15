import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createLocalDiskStorage,
  createLogger,
  createUnitOfWork,
  createDb,
  uuidV7Generator,
} from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import type { JobHandlerDeps } from '../job-handler.js'
import { mediaDeleteFiles } from './media-delete-files.js'

// `media.delete_files` (plan 04 Task 8): every copy of a deleted file goes, files and rows.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let deps: JobHandlerDeps
let org: string, workspace: string, owner: string

const storage = createLocalDiskStorage({ root: await mkdtemp(join(tmpdir(), 'media-delete-')) })
const VARIANTS = ['preview', 'thumbnail', 'reel'] as const

/** A file with its original and three copies stored. */
async function stored(status: 'ready' | 'deleted') {
  const id = await seed(tdb.runtimeUrl, (s) =>
    s.media(org, workspace, { uploadedBy: owner, status, storageKey: null }),
  )
  const prefix = `org/${org}/media/${id}/`
  await storage.put(`${prefix}original.mov`, Buffer.from('ftypqt'), {
    contentType: 'video/quicktime',
  })
  await admin.query('update media set storage_key = $2 where id = $1', [
    id,
    `${prefix}original.mov`,
  ])
  for (const purpose of VARIANTS) {
    const key = `${prefix}${purpose}.mp4`
    await storage.put(key, Buffer.from(purpose), { contentType: 'video/mp4' })
    await admin.query(
      `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime, size_bytes)
       values (gen_random_uuid(), $1, $2, $3, $4, 'video/mp4', 4)`,
      [org, id, purpose, key],
    )
  }
  return { id, prefix }
}

const run = (mediaId: string) =>
  mediaDeleteFiles({ id: 'lavoro', data: { organizationId: org, mediaId } }, deps)

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'media-delete' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  const logger = createLogger({ service: 'worker', level: 'error' })
  deps = {
    logger,
    storage,
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
  } as unknown as JobHandlerDeps
  ;({ org, workspace, owner } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const owner = await s.user()
    await s.member(org, owner, 'owner')
    return { org, workspace: await s.workspace(org), owner }
  }))
}, 120_000)

afterAll(async () => {
  await admin.end()
  await handle.close()
  await tdb.stop()
})

test('every variant and the original of a deleted file are removed, then their rows', async () => {
  const media = await stored('deleted')
  await run(media.id)
  expect(await storage.list(media.prefix)).toEqual([])
  const variants = await admin.query('select * from media_variants where media_id = $1', [media.id])
  expect(variants.rowCount).toBe(0)
  const { rows } = await admin.query<{ status: string; storage_key: string | null }>(
    'select status, storage_key from media where id = $1',
    [media.id],
  )
  // the row stays as a trace of the file, without its files
  expect(rows).toEqual([{ status: 'deleted', storage_key: null }])
  // again: nothing left to do, no error
  await run(media.id)
})

test('a file that is not deleted keeps its files', async () => {
  const media = await stored('ready')
  await run(media.id)
  expect(await storage.list(media.prefix)).toHaveLength(4)
  const variants = await admin.query('select * from media_variants where media_id = $1', [media.id])
  expect(variants.rowCount).toBe(3)
})
