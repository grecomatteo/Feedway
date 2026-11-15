import { getMedia } from '@app/application'
import { getMediaRoute } from '@app/contracts'

export default defineApiRoute(getMediaRoute, ({ actor, params }) =>
  getMedia(useDeps(), actor, { workspaceId: params.id, mediaId: params.mediaId }),
)
