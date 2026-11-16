import { updateFolder } from '@app/application'
import { updateFolderRoute } from '@app/contracts'

export default defineApiRoute(updateFolderRoute, ({ actor, params, body }) =>
  updateFolder(useDeps(), actor, {
    workspaceId: params.id,
    folderId: params.folderId,
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
  }),
)
