import { deleteFolder } from '@app/application'
import { deleteFolderRoute } from '@app/contracts'

export default defineApiRoute(deleteFolderRoute, async ({ actor, params, query, ip }) => {
  await deleteFolder(
    useDeps(),
    actor,
    {
      workspaceId: params.id,
      folderId: params.folderId,
      confirm: query.confirm === 'true',
    },
    { ip },
  )
  return { deleted: true as const }
})
