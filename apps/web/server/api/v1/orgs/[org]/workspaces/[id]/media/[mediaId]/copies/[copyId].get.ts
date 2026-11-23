import { readMediaCopy } from '@app/application'
import { mediaCopyRoute } from '@app/contracts'

// A copy that was published (plan 08 Task 10), for the page of the outcome: the panel only,
// never the public host. A copy thrown away, or of a file the person cannot see, is a 404.
export default defineApiRoute(mediaCopyRoute, async ({ event, actor, params }) => {
  const file = await readMediaCopy(useDeps(), actor, {
    workspaceId: params.id,
    mediaId: params.mediaId,
    copyId: params.copyId,
    range: parseByteRange(getRequestHeader(event, 'range')),
  })
  if (!file) throw new HttpProblem('NOT_FOUND')
  const { object, etag, contentType } = file
  return {
    body: object.body,
    size: object.size,
    contentType,
    etag,
    cacheControl: 'private, max-age=3600',
    ...(file.kind === 'part' && {
      part: { total: file.object.size, range: file.object.range },
      size: file.object.range === null ? 0 : file.object.range.end - file.object.range.start + 1,
    }),
  }
})
