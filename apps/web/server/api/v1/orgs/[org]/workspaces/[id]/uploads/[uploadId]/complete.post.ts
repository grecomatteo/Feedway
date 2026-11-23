import { completeUpload } from '@app/application'
import { completeUploadRoute } from '@app/contracts'

export default defineApiRoute(completeUploadRoute, ({ actor, params, query }) =>
  completeUpload(uploadDeps(), actor, {
    workspaceId: params.id,
    uploadId: params.uploadId,
    reuseInFolder: query.sameInFolder === 'reuse',
  }),
)
