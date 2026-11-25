import { startBulkImport } from '@app/application'
import { startBulkImportRoute } from '@app/contracts'

export default defineApiRoute(
  startBulkImportRoute,
  ({ actor, params, body }) =>
    startBulkImport(useDeps(), actor, {
      workspaceId: params.id,
      source: body.source,
      rows: body.rows.map(bulkRow),
    }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
