import { schedulePost } from '@app/application'
import { schedulePostRoute } from '@app/contracts'

export default defineApiRoute(schedulePostRoute, ({ actor, params, body, ip }) =>
  schedulePost(
    useDeps(),
    actor,
    { workspaceId: params.id, postId: params.postId, version: body.version },
    { ip },
  ),
)
