import { listMembers } from '@app/application'
import { listMembersRoute } from '@app/contracts'

export default defineApiRoute(listMembersRoute, async ({ actor }) => {
  const members = await listMembers(useDeps(), actor)
  return {
    items: members.map((m) => ({ ...m, lastLoginAt: m.lastLoginAt?.toISOString() ?? null })),
  }
})
