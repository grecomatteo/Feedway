import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { UnitOfWork } from '@app/application'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../../testing/index.js'

// The upload sessions' repository (plan 04 Task 9): the space they reserve, in the agency and in
// each workspace, and the completion one call at a time.

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
let org: string, user: string, wsA: string, wsB: string

const HOUR = 60 * 60 * 1000
const now = () => new Date()

async function open(workspaceId: string, sizeBytes: number, expiresInMs = HOUR) {
  const id = randomUUID()
  await uow.run({ organizationId: org, userId: user }, (tx) =>
    tx.uploads.create({
      id,
      organizationId: org,
      workspaceId,
      userId: user,
      folderId: null,
      originalName: 'video.mp4',
      mime: 'video/mp4',
      sizeBytes,
      firstPartSha256: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + expiresInMs),
    }),
  )
  return id
}

const reserved = (workspaceId: string, at = now()) =>
  uow.run({ organizationId: org, userId: user }, (tx) =>
    tx.uploads.reservedBytes(org, workspaceId, at),
  )

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'upload-sessions' })
  uow = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: createLogger({ service: 'worker', level: 'error' }),
  })
  ;({ org, user, wsA, wsB } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return { org, user, wsA: await s.workspace(org), wsB: await s.workspace(org) }
  }))
}, 120_000)

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('open uploads reserve their size in the agency and in their own workspace only', async () => {
  await open(wsA, 100)
  await open(wsA, 20)
  await open(wsB, 7)
  await open(wsA, 1000, -1000) // expired: it holds nothing
  expect(await reserved(wsA)).toEqual({ organization: 127, workspace: 120 })
  expect(await reserved(wsB)).toEqual({ organization: 127, workspace: 7 })
})

test('one completion at a time, and its upload keeps its space until it ends', async () => {
  const id = await open(wsB, 50, 1000)
  const claim = (at: Date, until: Date, upload = id) =>
    uow.run({ organizationId: org, userId: user }, (tx) =>
      tx.uploads.claimCompletion(org, upload, at, until),
    )
  const at = now()
  const until = new Date(at.getTime() + HOUR)
  expect(await claim(at, until)).toBe(true)
  expect(await claim(at, until)).toBe(false)
  // past its first expiry the space is still reserved: the hold moved it
  const later = new Date(at.getTime() + 10 * 60 * 1000)
  expect((await reserved(wsB, later)).workspace).toBe(57)
  // given back, another call may complete it at once
  await uow.run({ organizationId: org, userId: user }, (tx) =>
    tx.uploads.releaseCompletion(org, id),
  )
  expect(await claim(at, until)).toBe(true)
  // a hold that ran out can be taken again
  const long = await open(wsB, 1, 24 * HOUR)
  const minute = 60 * 1000
  expect(await claim(at, new Date(at.getTime() + minute), long)).toBe(true)
  const after = new Date(at.getTime() + 2 * minute)
  expect(await claim(after, new Date(after.getTime() + minute), long)).toBe(true)
})
