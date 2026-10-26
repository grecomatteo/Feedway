import { renameWorkspace } from '@app/application'
import { renameWorkspaceRoute } from '@app/contracts'

export default defineApiRoute(renameWorkspaceRoute, ({ actor, params, body, ip }) =>
  renameWorkspace(useDeps(), actor, params.id, body, { ip }),
)
