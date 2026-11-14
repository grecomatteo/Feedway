import { listProfilesWithoutClient } from '@app/application'
import { accountAvatarUrl } from '@app/domain'
import { profilesWithoutClientRoute } from '@app/contracts'

export default defineApiRoute(profilesWithoutClientRoute, async ({ actor, params }) => {
  const profiles = await listProfilesWithoutClient(useDeps(), actor)
  return {
    items: profiles.map((p) => ({
      key: p.key,
      name: p.name,
      accounts: p.accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        name: a.name,
        username: a.username,
        avatarUrl: accountAvatarUrl(params.org, a.id, a.avatarKey),
      })),
    })),
  }
})
