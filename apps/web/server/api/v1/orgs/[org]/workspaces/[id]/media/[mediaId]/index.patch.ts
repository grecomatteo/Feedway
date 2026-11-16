import { updateMedia } from '@app/application'
import { updateMediaRoute } from '@app/contracts'

export default defineApiRoute(updateMediaRoute, ({ actor, params, body }) =>
  updateMedia(useDeps(), actor, {
    workspaceId: params.id,
    mediaId: params.mediaId,
    ...(body.folderId === undefined ? {} : { folderId: body.folderId }),
    ...(body.tags === undefined ? {} : { tags: body.tags }),
  }),
)
