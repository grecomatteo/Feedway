import { replaceClientAccounts } from '@app/application'
import { replaceClientAccountsRoute } from '@app/contracts'

export default defineApiRoute(replaceClientAccountsRoute, async ({ actor, params, body, ip }) =>
  replaceClientAccounts(
    useDeps(),
    actor,
    { workspaceId: params.id, remove: body.remove, add: body.add },
    { ip },
  ),
)
