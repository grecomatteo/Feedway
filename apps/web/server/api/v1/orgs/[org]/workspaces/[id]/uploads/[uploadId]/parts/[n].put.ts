import { receiveUploadPart } from '@app/application'
import { uploadPartRoute } from '@app/contracts'

// A piece of an upload, read as it arrives: never held whole in memory (ADR 021).
export default defineApiRoute(uploadPartRoute, ({ actor, params, stream }) => {
  if (!stream) throw new Error('a binary route without its body')
  return receiveUploadPart(uploadDeps(), actor, {
    workspaceId: params.id,
    uploadId: params.uploadId,
    n: params.n,
    contentDigest: stream.digest,
    contentLength: stream.length,
    body: stream.body,
  })
})
