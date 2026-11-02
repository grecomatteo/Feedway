import { buildDataExport } from '@app/application'
import type { JobHandler } from '../job-handler.js'

export const identityDataExport: JobHandler<'identity.data_export'> = (job, deps) =>
  buildDataExport(
    {
      uow: deps.uow,
      storage: deps.storage,
      clock: deps.clock,
      zip: deps.zip,
      logger: deps.logger,
    },
    job.data,
  )
