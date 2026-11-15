import { deleteMedia } from '@app/application'
import { deleteMediaRoute } from '@app/contracts'

export default defineApiRoute(deleteMediaRoute, async ({ actor, params, ip }) => {
  await deleteMedia(useDeps(), actor, { workspaceId: params.id, mediaId: params.mediaId }, { ip })
  return { deleted: true as const }
})
