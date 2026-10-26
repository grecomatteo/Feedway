import { listWorkspaces } from '@app/application'
import { listWorkspacesRoute } from '@app/contracts'

export default defineApiRoute(listWorkspacesRoute, async ({ actor }) => ({
  items: await listWorkspaces(useDeps(), actor),
}))
