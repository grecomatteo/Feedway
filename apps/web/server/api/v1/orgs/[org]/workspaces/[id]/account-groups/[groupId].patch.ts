import { updateAccountGroup } from '@app/application'
import { updateAccountGroupRoute } from '@app/contracts'

export default defineApiRoute(
  updateAccountGroupRoute,
  ({ actor, params, body, ip }) =>
    updateAccountGroup(
      useDeps(),
      actor,
      {
        workspaceId: params.id,
        groupId: params.groupId,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.accountIds === undefined ? {} : { accountIds: body.accountIds }),
      },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
