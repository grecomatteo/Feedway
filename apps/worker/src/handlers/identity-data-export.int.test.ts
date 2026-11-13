import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { listDataExports } from '@app/application'
import {
  createAvatarProcessor,
  createRuntime,
  createZipWriter,
  notConfiguredMailer,
} from '@app/infrastructure'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { createTranslate, loadItalianMessages } from '../i18n.js'
import type { JobHandlerDeps } from '../job-handler.js'
import { identityDataExport } from './identity-data-export.js'

let tdb: TestDatabase
let runtime: Runtime
let mediaRoot: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  mediaRoot = await mkdtemp(join(tmpdir(), 'data-export-job-'))
  runtime = await createRuntime(
    {
      nodeEnv: 'production',
      databaseUrl: tdb.runtimeUrl,
      encryptionKey: randomBytes(32),
      logLevel: 'error',
      mediaRoot,
    },
    'worker',
  )
})
afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await rm(mediaRoot, { recursive: true, force: true })
  await tdb.stop()
})

const deps = (): JobHandlerDeps => ({
  queue: runtime.queue,
  logger: runtime.logger,
  uow: runtime.uow,
  clock: runtime.clock,
  ids: runtime.ids,
  storage: runtime.storage,
  credentials: { deleteAllCredentials: () => Promise.reject(new Error('not used')) },
  zip: createZipWriter(),
  mailer: notConfiguredMailer,
  signedTokens: runtime.signedTokens,
  translate: createTranslate(loadItalianMessages()),
  panel: {
    url: new URL('https://pannello.example.test'),
    productName: 'Feedway',
    defaultTimezone: 'Europe/Rome',
  },
  // the account jobs are not these tests'
  connectors: {},
  connectionTokens: {
    seal: () => Promise.reject(new Error('not used')),
    open: () => Promise.reject(new Error('not used')),
  },
  images: createAvatarProcessor(),
})

test('the job writes the archive and marks the export ready', async () => {
  const userId = await seed(tdb.runtimeUrl, (s) => s.user({ name: 'Marco Neri' }))
  const exportId = runtime.ids.newId()
  await runtime.uow.run({ userId }, (tx) =>
    tx.dataExports.create({ id: exportId, userId, createdAt: runtime.clock.now() }),
  )
  await identityDataExport({ id: 'job', data: { userId, exportId, ip: null } }, deps())
  const [ready] = await listDataExports({ uow: runtime.uow, clock: runtime.clock }, { id: userId })
  expect(ready).toMatchObject({ id: exportId, status: 'ready' })
  const object = await runtime.storage.get(`users/${userId}/exports/${exportId}.zip`)
  if (!object) throw new Error('archive missing')
  const chunks: Uint8Array[] = []
  for await (const c of object.body) chunks.push(c)
  // a ZIP archive (its content is checked in the infrastructure tests)
  expect(Buffer.concat(chunks).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
})
