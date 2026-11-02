import { requestDataExport } from '@app/application'
import { requestDataExportRoute } from '@app/contracts'

export default defineApiRoute(
  requestDataExportRoute,
  ({ session, ip }) => {
    const { uow, queue, clock, ids } = useDeps()
    return requestDataExport({ uow, queue, clock, ids }, session.user, session.session, { ip })
  },
  { rateLimit: DATA_EXPORT_RATE_LIMIT },
)
