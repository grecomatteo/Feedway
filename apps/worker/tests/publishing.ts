import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import {
  createPost,
  schedulePost,
  type PostsDeps,
  type PublishingWorkerDeps,
} from '@app/application'
import { instantToZoned, type OrgActor, type PostType } from '@app/domain'
import type { Runtime } from '@app/infrastructure'
import { jpegOfSizeWithGps, seed, type TestDatabase } from '@app/infrastructure/testing'
import {
  FORNO_LUCE,
  agency,
  connection,
  handlerDeps,
  recordingQueue,
  type Agency,
} from './accounts-jobs.js'
import { mediaProcess } from '../src/handlers/media-process.js'

// A scheduled post with real files and accounts, for the publishing's jobs (plan 07 Task 7):
// the agency of the account jobs, a client with the page and the Instagram profile, a photo
// processed by `media.process`, and the post scheduled through the panel's use cases. A host on
// loopback answers for `/m/*`, so the fake Graph API downloads something.

export interface PublishingWorld extends Agency {
  workspaceId: string
  actor: OrgActor
  accounts: { facebook: string; instagram: string }
  connectionId: string
}

/** A clock the test moves. */
export function testClock(start = new Date()) {
  let now = start
  return {
    now: () => now,
    set(at: Date) {
      now = at
    },
  }
}

export async function publishingWorld(
  tdb: TestDatabase,
  runtime: Runtime,
): Promise<PublishingWorld> {
  const of = await agency(tdb, runtime)
  const conn = await connection(runtime, of, { accounts: FORNO_LUCE })
  const facebook = conn.accounts[FORNO_LUCE[0].externalId] ?? ''
  const instagram = conn.accounts[FORNO_LUCE[1].externalId] ?? ''
  const workspaceId = await seed(tdb.runtimeUrl, (s) => s.workspace(of.organizationId))
  await runtime.uow.run({ organizationId: of.organizationId, userId: of.ownerId }, async (tx) => {
    await tx.workspaceAccounts.assign(of.organizationId, workspaceId, facebook)
    await tx.workspaceAccounts.assign(of.organizationId, workspaceId, instagram)
  })
  // green, as after the first health check
  const admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  await admin.query("update social_accounts set health = 'ok' where organization_id = $1", [
    of.organizationId,
  ])
  await admin.end()
  return {
    ...of,
    workspaceId,
    connectionId: conn.id,
    accounts: { facebook, instagram },
    actor: {
      userId: of.ownerId,
      platformRole: null,
      organizationId: of.organizationId,
      orgRole: 'owner',
      memberships: new Map(),
    },
  }
}

/** A photo uploaded and processed, as the library has it. */
export async function readyPhoto(
  tdb: TestDatabase,
  runtime: Runtime,
  admin: pg.Client,
  world: PublishingWorld,
): Promise<string> {
  const id = await seed(tdb.runtimeUrl, (s) =>
    s.media(world.organizationId, world.workspaceId, {
      uploadedBy: world.ownerId,
      kind: 'image',
      status: 'processing',
    }),
  )
  const bytes = await jpegOfSizeWithGps(1080, 1350)
  const key = `org/${world.organizationId}/media/${id}/original.jpg`
  await runtime.storage.put(key, bytes, { contentType: 'image/jpeg' })
  await admin.query(
    "update media set storage_key = $2, mime = 'image/jpeg', size_bytes = $3 where id = $1",
    [id, key, bytes.length],
  )
  // a wake-up takes the next file at its agency's turn: files of other tests may come first
  for (let turn = 0; turn < 10; turn += 1) {
    await mediaProcess(
      { id: `process-${id}`, data: { organizationId: world.organizationId, mediaId: id } },
      handlerDeps(runtime, recordingQueue()),
    )
    const { rows } = await admin.query<{ status: string }>(
      'select status from media where id = $1',
      [id],
    )
    if (rows[0]?.status !== 'processing') break
  }
  return id
}

export function postsDeps(runtime: Runtime, queue = recordingQueue()): PostsDeps {
  return {
    uow: runtime.uow,
    clock: runtime.clock,
    queue,
    logger: runtime.logger,
    ids: runtime.ids,
    newPublicToken: runtime.newPublicToken,
    platformRules: runtime.platformRules,
    publishingHistory: runtime.publishingHistory,
  }
}

/** A post scheduled through the panel at `at` on the accounts given; its id and its targets. */
export async function scheduledPost(
  runtime: Runtime,
  world: PublishingWorld,
  opts: {
    at: Date
    mediaIds: string[]
    accounts: string[]
    type?: PostType
    caption?: string
    queue?: ReturnType<typeof recordingQueue>
  },
): Promise<{ postId: string; version: number }> {
  const { localDate, localTime } = instantToZoned(opts.at, 'Europe/Rome')
  const deps = postsDeps(runtime, opts.queue)
  const draft = await createPost(
    deps,
    world.actor,
    {
      workspaceId: world.workspaceId,
      type: opts.type ?? 'photo',
      mediaIds: opts.mediaIds,
      caption: { common: opts.caption ?? 'Pane caldo alle 18' },
      destinations: opts.accounts.map((accountId) => ({ accountId })),
      when: { localDate, localTime },
    },
    { ip: null },
  )
  const post = await schedulePost(
    deps,
    world.actor,
    { workspaceId: world.workspaceId, postId: draft.id, version: draft.version },
    { ip: null },
  ).catch((error: unknown) => {
    const details = (error as { details?: { report?: { outcomes?: unknown[] } } }).details
    throw new Error(`not scheduled: ${JSON.stringify(details?.report?.outcomes)}`)
  })
  return { postId: post.id, version: post.version }
}

/** The worker's deps on the runtime, with the clock of the test and the host of `/m/*`. */
export function workerDeps(
  runtime: Runtime,
  clock: { now(): Date },
  publicUrl: URL,
  queue = recordingQueue(),
): PublishingWorkerDeps & { queue: ReturnType<typeof recordingQueue> } {
  const connector = runtime.connectors.meta_system_user
  if (!connector) throw new Error('the runtime has no Meta connector')
  return {
    uow: runtime.uow,
    clock,
    queue,
    logger: runtime.logger,
    ids: runtime.ids,
    newPublicToken: runtime.newPublicToken,
    publishers: runtime.publishers,
    connectors: { meta_system_user: connector, meta_business_login: connector },
    connectionTokens: runtime.connectionTokens,
    platformRules: runtime.platformRules,
    publishingHistory: runtime.publishingHistory,
    publicUrl,
    storage: runtime.storage,
  }
}

/** The public host on loopback: every `/m/*` answers with a small JPEG, and is counted. */
export async function publicHost(): Promise<{ url: URL; paths: string[]; stop(): Promise<void> }> {
  const paths: string[] = []
  const jpeg = await jpegOfSizeWithGps(64, 64)
  const server: Server = createServer((req, res) => {
    paths.push(req.url ?? '')
    if (!req.url?.startsWith('/m/')) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpeg.length }).end(jpeg)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: new URL(`http://127.0.0.1:${String(port)}/`),
    paths,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

export interface TargetRow {
  id: string
  account_id: string
  status: string
  step: string | null
  generation: number
  attempts: number
  next_attempt_at: Date | null
  external_post_id: string | null
  permalink: string | null
  last_error_code: string | null
  meta_ids: Record<string, unknown> | null
  claimed_until: Date | null
}

export async function targetsOf(admin: pg.Client, postId: string): Promise<TargetRow[]> {
  return (
    await admin.query<TargetRow>(
      `select id, account_id, status, step, generation, attempts, next_attempt_at,
              external_post_id, permalink, last_error_code, meta_ids, claimed_until
         from post_targets where post_id = $1 order by created_at, id`,
      [postId],
    )
  ).rows
}

export async function postStatusOf(admin: pg.Client, postId: string): Promise<string | undefined> {
  return (await admin.query<{ status: string }>('select status from posts where id = $1', [postId]))
    .rows[0]?.status
}
