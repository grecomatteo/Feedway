import { createWorkspace } from '@app/application'
import { createWorkspaceRoute } from '@app/contracts'

export default defineApiRoute(createWorkspaceRoute, ({ actor, body, ip }) =>
  createWorkspace(useDeps(), actor, body, { ip }),
)
