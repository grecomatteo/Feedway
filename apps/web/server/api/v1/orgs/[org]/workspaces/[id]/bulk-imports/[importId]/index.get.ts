import { getBulkImport } from '@app/application'
import { getBulkImportRoute } from '@app/contracts'

export default defineApiRoute(getBulkImportRoute, ({ actor, params }) =>
  getBulkImport(useDeps(), actor, { workspaceId: params.id, importId: params.importId }),
)
