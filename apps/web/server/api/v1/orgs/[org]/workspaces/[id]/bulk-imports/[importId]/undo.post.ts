import { undoBulkImport } from '@app/application'
import { undoBulkImportRoute } from '@app/contracts'

export default defineApiRoute(
  undoBulkImportRoute,
  ({ actor, params, ip }) =>
    undoBulkImport(useDeps(), actor, { workspaceId: params.id, importId: params.importId }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
