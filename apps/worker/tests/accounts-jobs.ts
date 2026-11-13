import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionKind, ConnectionStatus, Platform } from '@app/domain'
import type { JobQueue } from '@app/application'
import {
  createAvatarProcessor,
  createRuntime,
  createZipWriter,
  notConfiguredMailer,
  type Runtime,
} from '@app/infrastructure'
import { seed, type TestDatabase } from '@app/infrastructure/testing'
import { META_MOCK, type MetaMock } from '@app/meta-mock'
import { createTranslate, loadItalianMessages } from '../src/i18n.js'
import type { JobHandlerDeps } from '../src/job-handler.js'

// Agencies with a Meta app, connections and imported accounts, written directly: the account
// jobs' tests start from what the import leaves (plan 03 Task 10). Only the fake Graph API.

export interface QueuedJob {
  name: string
  data: unknown
  opts: unknown
}

/** A worker runtime on the fake Graph API, with the real queue. */
export async function accountsRuntime(tdb: TestDatabase, mock: MetaMock): Promise<Runtime> {
  return createRuntime(
    {
      nodeEnv: 'production',
      databaseUrl: tdb.runtimeUrl,
      encryptionKey: randomBytes(32),
      logLevel: 'error',
      mediaRoot: await mkdtemp(join(tmpdir(), 'accounts-jobs-')),
      metaMode: 'mock',
      metaGraphVersion: 'v25.0',
      metaMockUrl: mock.url,
    },
    'worker',
  )
}

/**
 * What the handlers get. Both kinds use the system user's connector: the unified login has none
 * yet (Task 7), and a second connection is all the tests need of it.
 */
export function handlerDeps(
  runtime: Runtime,
  queue: Pick<JobQueue, 'send'> = runtime.queue,
): JobHandlerDeps {
  const connector = runtime.connectors.meta_system_user
  if (!connector) throw new Error('the runtime has no Meta connector')
  return {
    queue,
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
    connectors: { meta_system_user: connector, meta_business_login: connector },
    connectionTokens: runtime.connectionTokens,
    images: createAvatarProcessor(),
  }
}

/** A queue that only records what is sent. */
export function recordingQueue(): Pick<JobQueue, 'send'> & { sent: QueuedJob[] } {
  const sent: QueuedJob[] = []
  return {
    sent,
    send: (name, data, opts) => {
      sent.push({ name, data, opts })
      return Promise.resolve(randomUUID())
    },
  }
}

export interface Agency {
  organizationId: string
  ownerId: string
}

export async function agency(tdb: TestDatabase, runtime: Runtime): Promise<Agency> {
  const { organizationId, ownerId } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return { organizationId: org, ownerId: user }
  })
  await runtime.uow.run({ organizationId, userId: ownerId }, async (tx) => {
    await runtime.keyRing.createOrganizationKey(tx, organizationId)
    await runtime.integrations.replace(tx, organizationId, 'meta', {
      config: {
        appId: META_MOCK.app.id,
        configId: null,
        businessId: null,
        dataUseCheckupDueOn: null,
      },
      secret: META_MOCK.app.secret,
      updatedBy: ownerId,
      expectedVersion: null,
      verifiedAt: new Date(),
    })
  })
  return { organizationId, ownerId }
}

export interface AccountSeed {
  platform: Platform
  externalId: string
  name?: string
  pageId?: string | null
  /** The picture's address as Meta gave it; none by default. */
  avatarUrl?: string
}

/** A working connection with its imported accounts, as `importAccounts` leaves them. */
export async function connection(
  runtime: Runtime,
  of: Agency,
  opts: {
    kind?: ConnectionKind
    token?: string
    externalUserId?: string
    expiresAt?: Date | null
    status?: ConnectionStatus
    accounts?: readonly AccountSeed[]
  } = {},
): Promise<{ id: string; accounts: Record<string, string> }> {
  const { organizationId, ownerId } = of
  return runtime.uow.run({ organizationId, userId: ownerId }, async (tx) => {
    const id = runtime.ids.newId()
    const sealed = await runtime.connectionTokens.seal(
      tx,
      { organizationId, id },
      opts.token ?? META_MOCK.tokens.systemUser,
    )
    await tx.connections.create({
      id,
      organizationId,
      kind: opts.kind ?? 'meta_system_user',
      externalUserId: opts.externalUserId ?? META_MOCK.users.systemUser,
      connectedBy: ownerId,
      ...sealed,
      expiresAt: opts.expiresAt ?? null,
    })
    await tx.connections.setStatus(organizationId, id, opts.status ?? 'active')
    const accounts: Record<string, string> = {}
    for (const a of opts.accounts ?? []) {
      const row = await tx.accounts.upsertImported({
        organizationId,
        platform: a.platform,
        externalId: a.externalId,
        name: a.name ?? `Account ${a.externalId}`,
        username: null,
        avatarUrl: a.avatarUrl ?? null,
        pageId: a.pageId ?? null,
        connectionId: id,
        at: new Date(),
      })
      accounts[a.externalId] = row.id
    }
    return { id, accounts }
  })
}

const { pages, instagram } = META_MOCK

/** What the system user sees and the agency imported: the page with Instagram, and both. */
export const FORNO_LUCE: readonly [AccountSeed, AccountSeed] = [
  { platform: 'facebook', externalId: pages.withInstagram, pageId: pages.withInstagram },
  { platform: 'instagram', externalId: instagram.ofPage, pageId: pages.withInstagram },
]
