import { cancelPost } from '@app/application'
import { cancelPostRoute } from '@app/contracts'

export default defineApiRoute(cancelPostRoute, ({ actor, params, body, ip }) =>
  cancelPost(
    useDeps(),
    actor,
    { workspaceId: params.id, postId: params.postId, version: body.version },
    { ip },
  ),
)
