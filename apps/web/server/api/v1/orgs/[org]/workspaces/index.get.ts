import { listWorkspaces, workspacePhotos } from '@app/application'
import { listWorkspacesRoute } from '@app/contracts'
import { accountAvatarUrl } from '@app/domain'

export default defineApiRoute(listWorkspacesRoute, async ({ actor, params }) => {
  const deps = useDeps()
  const [workspaces, photos] = await Promise.all([
    listWorkspaces(deps, actor),
    workspacePhotos(deps, actor),
  ])
  return {
    items: workspaces.map((w) => {
      const photo = photos.get(w.id)
      return {
        ...w,
        photoUrl: photo ? accountAvatarUrl(params.org, photo.accountId, photo.avatarKey) : null,
      }
    }),
  }
})
