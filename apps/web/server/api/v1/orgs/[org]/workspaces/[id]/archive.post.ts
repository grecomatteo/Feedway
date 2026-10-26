import { archiveWorkspace } from '@app/application'
import { archiveWorkspaceRoute } from '@app/contracts'

export default defineApiRoute(archiveWorkspaceRoute, async ({ actor, params, ip }) => {
  await archiveWorkspace(useDeps(), actor, params.id, { ip })
  return { archived: true as const }
})
