import { buildDataExport, type Logger } from '@app/application'
import {
  createDb,
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
    for (const { id } of rows) await buildDataExport(deps, { userId, exportId: id })
  } finally {
    await admin.close()
    await db.close()
  }
}
