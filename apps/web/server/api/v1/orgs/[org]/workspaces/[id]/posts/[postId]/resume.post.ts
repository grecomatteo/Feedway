import { resumePaused } from '@app/application'
import { resumePostRoute } from '@app/contracts'

export default defineApiRoute(
  resumePostRoute,
  ({ actor, params, body, ip }) =>
    resumePaused(
      useDeps(),
      actor,
      {
        workspaceId: params.id,
        postId: params.postId,
        version: body.version,
        ...(body.when === undefined ? {} : { when: body.when }),
      },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
