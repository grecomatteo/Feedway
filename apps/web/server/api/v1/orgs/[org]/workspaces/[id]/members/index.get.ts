import { listWorkspaceMembers } from '@app/application'
import { listWorkspaceMembersRoute } from '@app/contracts'

export default defineApiRoute(listWorkspaceMembersRoute, async ({ actor, params }) => ({
  items: await listWorkspaceMembers(useDeps(), actor, params.id),
}))
