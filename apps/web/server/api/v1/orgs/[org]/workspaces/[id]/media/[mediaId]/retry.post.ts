import { retryMedia } from '@app/application'
import { retryMediaRoute } from '@app/contracts'

export default defineApiRoute(retryMediaRoute, async ({ actor, params, ip }) =>
  retryMedia(useDeps(), actor, { workspaceId: params.id, mediaId: params.mediaId }, { ip }),
)
