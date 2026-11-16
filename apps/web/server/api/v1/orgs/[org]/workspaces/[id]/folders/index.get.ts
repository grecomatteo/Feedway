import { listFolders } from '@app/application'
import { listFoldersRoute } from '@app/contracts'

export default defineApiRoute(listFoldersRoute, ({ actor, params }) =>
  listFolders(useDeps(), actor, { workspaceId: params.id }),
)
