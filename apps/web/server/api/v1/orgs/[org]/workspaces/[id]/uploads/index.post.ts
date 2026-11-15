import { startUpload } from '@app/application'
import { startUploadRoute } from '@app/contracts'

export default defineApiRoute(startUploadRoute, ({ actor, params, body }) =>
  startUpload(uploadDeps(), actor, { workspaceId: params.id, ...body }),
)
