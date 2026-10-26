import { listInvites } from '@app/application'
import { listInvitesRoute } from '@app/contracts'

export default defineApiRoute(listInvitesRoute, async ({ actor }) => {
  const invites = await listInvites(useDeps(), actor)
  return { items: invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })) }
})
