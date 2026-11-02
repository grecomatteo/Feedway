import { openDataExport } from '@app/application'
import { downloadDataExportRoute } from '@app/contracts'

// Only the owner's own row is looked up: someone else's id is simply not found (404).
export default defineApiRoute(
  downloadDataExportRoute,
  async ({ params, session }) => {
    const { uow, storage, clock } = useDeps()
    const { object, createdAt } = await openDataExport(
      { uow, storage, clock },
      session.user,
      session.session,
      params.id,
    )
    return {
      body: object.body,
      size: object.size,
      cacheControl: 'private, no-store',
      filename: `dati-personali-${createdAt.toISOString().slice(0, 10)}.zip`,
    }
  },
  { rateLimit: DATA_EXPORT_RATE_LIMIT },
)
