import { listAccountGroups } from '@app/application'
import { listAccountGroupsRoute } from '@app/contracts'

export default defineApiRoute(listAccountGroupsRoute, ({ actor, params }) =>
  listAccountGroups(useDeps(), actor, { workspaceId: params.id }),
)
