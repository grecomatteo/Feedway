import { cancelUpload } from '@app/application'
import { cancelUploadRoute } from '@app/contracts'

export default defineApiRoute(cancelUploadRoute, async ({ actor, params }) => {
  await cancelUpload(uploadDeps(), actor, { workspaceId: params.id, uploadId: params.uploadId })
  return { deleted: true as const }
})
