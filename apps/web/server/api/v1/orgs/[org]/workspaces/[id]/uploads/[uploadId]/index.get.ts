import { getUpload } from '@app/application'
import { getUploadRoute } from '@app/contracts'

export default defineApiRoute(getUploadRoute, ({ actor, params }) =>
  getUpload(uploadDeps(), actor, { workspaceId: params.id, uploadId: params.uploadId }),
)
