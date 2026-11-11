import { assignAccount } from '@app/application'
import { assignAccountRoute } from '@app/contracts'

export default defineApiRoute(assignAccountRoute, async ({ actor, params, ip }) => {
  await assignAccount(
    useDeps(),
    actor,
    { workspaceId: params.id, accountId: params.accountId },
    { ip },
  )
  return { assigned: true as const }
})
