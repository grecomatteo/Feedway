import { buildDataExport, refreshAccountAvatar, type Logger } from '@app/application'
import {
  createAvatarProcessor,
  createDb,
  createRuntime,
  createLocalDiskStorage,
  createUnitOfWork,
  createZipWriter,
  systemClock,
  uuidV7Generator,
} from '@app/infrastructure'

const quiet: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
}

/** Does what the worker would: prepares the person's pending "Scarica i miei dati" archive. */
export async function runDataExportJob(userId: string): Promise<void> {
  const runtimeUrl = process.env.E2E_DATABASE_URL
  const adminUrl = process.env.E2E_ADMIN_URL
  const mediaRoot = process.env.E2E_MEDIA_ROOT
  if (!runtimeUrl || !adminUrl || !mediaRoot) throw new Error('e2e environment not available')
  const admin = createDb(adminUrl, { max: 1, applicationName: 'e2e-jobs' })
  const db = createDb(runtimeUrl, { max: 2, applicationName: 'e2e-jobs' })
  try {
    const { rows } = await admin.pool.query<{ id: string }>(
      `select id from data_exports where user_id = $1 and status in ('pending', 'running')`,
      [userId],
    )
    const deps = {
      uow: createUnitOfWork({ db: db.db, ids: uuidV7Generator, logger: quiet }),
      storage: createLocalDiskStorage({ root: mediaRoot }),
      clock: systemClock,
      zip: createZipWriter(),
      logger: quiet,
    }
    for (const { id } of rows) await buildDataExport(deps, { userId, exportId: id, ip: null })
  } finally {
    await admin.close()
    await db.close()
  }
}

/**
 * Does what the worker would after an import: copies the pictures of the agency's accounts from
 * the fake Graph API into the panel's storage (`accounts.avatar`, plan 04 Task 4).
 */
export async function runAccountAvatarJobs(organizationId: string): Promise<void> {
  const runtimeUrl = process.env.E2E_DATABASE_URL
  const adminUrl = process.env.E2E_ADMIN_URL
  const mediaRoot = process.env.E2E_MEDIA_ROOT
  const metaMockUrl = process.env.E2E_META_MOCK_URL
  const key = process.env.E2E_ENCRYPTION_KEY
  if (!runtimeUrl || !adminUrl || !mediaRoot || !metaMockUrl || !key)
    throw new Error('e2e environment not available')
  const admin = createDb(adminUrl, { max: 1, applicationName: 'e2e-jobs' })
  const runtime = await createRuntime(
    {
      nodeEnv: 'production',
      databaseUrl: runtimeUrl,
      encryptionKey: Buffer.from(key, 'base64'),
      logLevel: 'error',
      mediaRoot,
      metaMode: 'mock',
      metaGraphVersion: 'v25.0',
      metaMockUrl,
    },
    'worker',
  )
  try {
    const { rows } = await admin.pool.query<{ id: string }>(
      'select id from social_accounts where organization_id = $1 and avatar_url is not null',
      [organizationId],
    )
    const deps = {
      uow: runtime.uow,
      storage: runtime.storage,
      images: createAvatarProcessor(),
      connectors: runtime.connectors,
      logger: quiet,
    }
    for (const { id } of rows) await refreshAccountAvatar(deps, { organizationId, accountId: id })
  } finally {
    await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
    await runtime.close()
    await admin.close()
  }
}
