import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createDb,
  createDiskUploadParts,
  createLogger,
  createUnitOfWork,
  systemClock,
  uuidV7Generator,
} from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import type { JobHandlerDeps } from '../job-handler.js'
import { recordingQueue } from '../../tests/accounts-jobs.js'
import { mediaUploadsCleanup } from './media-uploads-cleanup.js'

// `media.uploads_cleanup` (plan 04 Task 9), every hour: expired uploads go with their pieces and
// their reserved space, pieces no upload knows go after an hour, and a deleted file whose bytes
// are still there is queued again to `media.delete_files`. In every agency.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let dir: string
let queue: ReturnType<typeof recordingQueue>
let deps: JobHandlerDeps

const HOUR = 60 * 60 * 1000

async function agency() {
  return seed(tdb.runtimeUrl, async (s) => {
    const organizationId = await s.organization()
    const ownerId = await s.user()
    await s.member(organizationId, ownerId, 'owner')
    return { organizationId, ownerId, workspaceId: await s.workspace(organizationId) }
  })
}
type Agency = Awaited<ReturnType<typeof agency>>

/** An upload with one piece on disk; `expiresInMs` < 0: already expired. */
async function upload(of: Agency, opts: { expiresInMs: number; completed?: boolean }) {
  const id = randomUUID()
  let mediaId: string | null = null
  if (opts.completed)
    mediaId = await seed(tdb.runtimeUrl, (s) =>
      s.media(of.organizationId, of.workspaceId, { uploadedBy: of.ownerId, status: 'processing' }),
    )
  await admin.query(
    `insert into upload_sessions (id, organization_id, workspace_id, user_id, original_name, mime,
                                  size_bytes, first_part_sha256, parts, expires_at, completed_at,
                                  media_id)
     values ($1, $2, $3, $4, 'video.mp4', 'video/mp4', 10, repeat('a', 64), '{"1": "x"}',
             now() + make_interval(secs => $5::double precision / 1000), $6, $7)`,
    [
      id,
      of.organizationId,
      of.workspaceId,
      of.ownerId,
      opts.expiresInMs,
      opts.completed ? new Date() : null,
      mediaId,
    ],
  )
  await piece(of.organizationId, id)
  return id
}

async function piece(organizationId: string, uploadId: string, ageMs = 0) {
  const folder = join(dir, organizationId, uploadId)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '1'), 'pezzo')
  const at = new Date(Date.now() - ageMs)
  await utimes(folder, at, at)
}

const hasPieces = (of: Agency, uploadId: string) =>
  existsSync(join(dir, of.organizationId, uploadId))

const sessionIds = async (of: Agency) =>
  (
    await admin.query<{ id: string }>('select id from upload_sessions where organization_id = $1', [
      of.organizationId,
    ])
  ).rows.map((r) => r.id)

const run = () => mediaUploadsCleanup({ id: 'giro', data: {} }, deps)

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'uploads-cleanup' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  dir = await mkdtemp(join(tmpdir(), 'uploads-cleanup-'))
  const logger = createLogger({ service: 'worker', level: 'error' })
  queue = recordingQueue()
  deps = {
    logger,
    queue,
    clock: systemClock,
    uploadParts: createDiskUploadParts({ dir }),
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
  } as unknown as JobHandlerDeps
}, 120_000)

afterAll(async () => {
  await admin.end()
  await handle.close()
  await tdb.stop()
})

test('expired uploads go with their pieces, in every agency; open ones stay', async () => {
  const a = await agency()
  const b = await agency()
  const expiredA = await upload(a, { expiresInMs: -1000 })
  const expiredB = await upload(b, { expiresInMs: -1000 })
  const doneLongAgo = await upload(a, { expiresInMs: -1000, completed: true })
  const open = await upload(a, { expiresInMs: HOUR })
  const doneRecently = await upload(a, { expiresInMs: HOUR, completed: true })
  await run()
  expect((await sessionIds(a)).sort()).toEqual([open, doneRecently].sort())
  expect(await sessionIds(b)).toEqual([])
  for (const [of, id] of [
    [a, expiredA],
    [b, expiredB],
    [a, doneLongAgo],
  ] as const)
    expect(hasPieces(of, id)).toBe(false)
  expect(hasPieces(a, open)).toBe(true)
  // the files the completed uploads became stay: only the sessions go
  const { rows } = await admin.query('select 1 from media where organization_id = $1', [
    a.organizationId,
  ])
  expect(rows).toHaveLength(2)
})

test('pieces no upload knows go after an hour, not before', async () => {
  const a = await agency()
  const old = randomUUID()
  const fresh = randomUUID()
  await piece(a.organizationId, old, 2 * HOUR)
  await piece(a.organizationId, fresh, 60_000)
  // a folder that is not an upload's is not ours to remove
  await mkdir(join(dir, a.organizationId, 'altro'), { recursive: true })
  await run()
  expect(hasPieces(a, old)).toBe(false)
  expect(hasPieces(a, fresh)).toBe(true)
  expect(existsSync(join(dir, a.organizationId, 'altro'))).toBe(true)
})

test('a deleted file with bytes still stored is queued again to media.delete_files', async () => {
  const a = await agency()
  const [withOriginal, withCopy, cleaned, alive] = await seed(tdb.runtimeUrl, async (s) => {
    const by = { uploadedBy: a.ownerId }
    return [
      await s.media(a.organizationId, a.workspaceId, { ...by, status: 'deleted' }),
      await s.media(a.organizationId, a.workspaceId, {
        ...by,
        status: 'deleted',
        storageKey: null,
        variants: [
          {
            purpose: 'preview',
            storageKey: `org/${a.organizationId}/media/x/preview.mp4`,
            mime: 'video/mp4',
            sizeBytes: 4,
          },
        ],
      }),
      await s.media(a.organizationId, a.workspaceId, {
        ...by,
        status: 'deleted',
        storageKey: null,
      }),
      await s.media(a.organizationId, a.workspaceId, by),
    ]
  })
  queue.sent.length = 0
  await run()
  const ofA = queue.sent.filter(
    (j) => (j.data as { organizationId: string }).organizationId === a.organizationId,
  )
  expect(ofA.map((j) => j.name)).toEqual(['media.delete_files', 'media.delete_files'])
  expect(ofA.map((j) => (j.data as { mediaId: string }).mediaId).sort()).toEqual(
    [withOriginal, withCopy].sort(),
  )
  expect(ofA.map((j) => j.data)).not.toContainEqual(expect.objectContaining({ mediaId: cleaned }))
  expect(ofA.map((j) => j.data)).not.toContainEqual(expect.objectContaining({ mediaId: alive }))
  // at most once an hour per file, whatever the number of runs
  for (const j of ofA)
    expect((j.opts as { dedupeKey?: string }).dedupeKey).toMatch(
      new RegExp(
        `^cleanup:\\d{4}-\\d{2}-\\d{2}T\\d{2}:${(j.data as { mediaId: string }).mediaId}$`,
      ),
    )
})
