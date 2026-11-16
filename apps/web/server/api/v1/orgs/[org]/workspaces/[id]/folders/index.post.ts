import { createFolder } from '@app/application'
import { createFolderRoute } from '@app/contracts'

export default defineApiRoute(createFolderRoute, ({ actor, params, body }) =>
  createFolder(useDeps(), actor, { workspaceId: params.id, ...body }),
)
