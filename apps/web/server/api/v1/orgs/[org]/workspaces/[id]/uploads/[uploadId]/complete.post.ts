import { completeUpload } from '@app/application'
import { completeUploadRoute } from '@app/contracts'

export default defineApiRoute(completeUploadRoute, ({ actor, params }) =>
  completeUpload(uploadDeps(), actor, { workspaceId: params.id, uploadId: params.uploadId }),
)
