import { listProfiles } from '@app/application'
import { workspaceProfilesRoute } from '@app/contracts'

export default defineApiRoute(workspaceProfilesRoute, async ({ actor, params }) => {
  const profiles = await listProfiles(useDeps(), actor, { workspaceId: params.id })
  return {
    items: profiles.map((p) => ({
      key: p.key,
      id: p.id,
      accounts: p.accounts.map(workspaceAccountDto(params.org)),
    })),
  }
})
