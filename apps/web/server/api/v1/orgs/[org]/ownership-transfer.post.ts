import { transferOwnership } from '@app/application'
import { ownershipTransferRoute } from '@app/contracts'

export default defineApiRoute(ownershipTransferRoute, async ({ actor, session, body, ip }) => {
  await transferOwnership(identityDeps(useDeps()), actor, session.session, body.userId, { ip })
  return { transferred: true as const }
})
