import { readMediaFile } from '@app/application'
import { mediaFileRoute } from '@app/contracts'

// A copy of a file, for the panel only (plan 04 Task 8): never on the public host, never the
// original. Any file the person cannot see is a 404, as a copy not made yet.
export default defineApiRoute(mediaFileRoute, async ({ event, actor, params }) => {
  const file = await readMediaFile(useDeps(), actor, {
    workspaceId: params.id,
    mediaId: params.mediaId,
    variant: params.variant,
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
