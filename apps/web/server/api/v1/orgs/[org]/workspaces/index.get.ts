import { clientProfiles, listWorkspaces } from '@app/application'
import { listWorkspacesRoute } from '@app/contracts'
import { accountAvatarUrl, profilePhotoAccount } from '@app/domain'

export default defineApiRoute(listWorkspacesRoute, async ({ actor, params }) => {
  const deps = useDeps()
  const [workspaces, profiles] = await Promise.all([
    listWorkspaces(deps, actor),
    clientProfiles(deps, actor),
  ])
  const avatar = (a: { id: string; avatarKey: string | null }) =>
    accountAvatarUrl(params.org, a.id, a.avatarKey)
  return {
    items: workspaces.map((w) => {
      const mine = profiles.get(w.id) ?? []
      // the switcher's picture: that of the first profile with one (§3)
      const photo = mine.map((p) => profilePhotoAccount(p.accounts)).find((a) => a !== null)
      return {
        ...w,
        photoUrl: photo ? avatar(photo) : null,
        profiles: mine.map((p) => ({
          key: p.key,
          link: p.link,
          accounts: p.accounts.map((a) => ({
            id: a.id,
            platform: a.platform,
            name: a.name,
            username: a.username,
            avatarUrl: avatar(a),
          })),
        })),
      }
    }),
  }
})
