import { removeEmptyDrafts } from '@app/application'
import { deleteEmptyDraftsRoute } from '@app/contracts'

export default defineApiRoute(
  deleteEmptyDraftsRoute,
  ({ actor, body, ip }) =>
    removeEmptyDrafts(
      useDeps(),
      actor,
      {
        ...(body.workspaceId === undefined ? {} : { workspaceId: body.workspaceId }),
        ...(body.all === undefined ? {} : { all: body.all }),
      },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
