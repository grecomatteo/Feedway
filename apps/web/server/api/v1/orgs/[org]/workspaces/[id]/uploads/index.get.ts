import { listUploads } from '@app/application'
import { listUploadsRoute } from '@app/contracts'

export default defineApiRoute(listUploadsRoute, async ({ actor, params }) => {
  const { media } = useDeps().config
  return {
    items: await listUploads(uploadDeps(), actor, { workspaceId: params.id }),
    limits: { maxImageBytes: media.maxImageBytes, maxVideoBytes: media.maxVideoBytes },
  }
})
