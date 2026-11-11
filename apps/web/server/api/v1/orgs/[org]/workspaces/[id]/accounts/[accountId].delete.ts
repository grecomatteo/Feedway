import { unassignAccount } from '@app/application'
import { unassignAccountRoute } from '@app/contracts'

export default defineApiRoute(unassignAccountRoute, async ({ actor, params, ip }) => {
  await unassignAccount(
    useDeps(),
    actor,
    { workspaceId: params.id, accountId: params.accountId },
    { ip },
  )
  return { removed: true as const }
})
