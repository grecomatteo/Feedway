import { deleteFolder } from '@app/application'
import { deleteFolderRoute } from '@app/contracts'

export default defineApiRoute(deleteFolderRoute, async ({ actor, params, query }) => {
  await deleteFolder(useDeps(), actor, {
    workspaceId: params.id,
    folderId: params.folderId,
    confirm: query.confirm === 'true',
  })
  return { deleted: true as const }
})
