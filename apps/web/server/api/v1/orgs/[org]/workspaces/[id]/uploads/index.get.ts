import { listUploads } from '@app/application'
import { listUploadsRoute } from '@app/contracts'

export default defineApiRoute(listUploadsRoute, async ({ actor, params }) => ({
  items: await listUploads(uploadDeps(), actor, { workspaceId: params.id }),
}))
