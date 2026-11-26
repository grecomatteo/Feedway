import { getGridThumbnail } from '@app/application'
import { calendarGridThumbnailRoute } from '@app/contracts'

// The picture of a post out on Instagram (plan 09 Task 12, P4): downloaded from Meta at every
// request, never kept; the browser keeps it five minutes. Each one is a call to Meta, counted
// for the person and for the account. Anything else is a 404.
export default defineApiRoute(
  calendarGridThumbnailRoute,
  async ({ actor, params }) => {
    await limitAccount(GRID_ACCOUNT_THUMBNAILS_LIMIT, actor.organizationId, params.accountId)
    const picture = await getGridThumbnail(useDeps(), actor, {
      workspaceId: params.id,
      accountId: params.accountId,
      mediaId: params.igMediaId,
    })
    if (!picture) throw new HttpProblem('NOT_FOUND')
    return {
      body: picture.bytes,
      size: picture.bytes.byteLength,
      contentType: picture.contentType,
      cacheControl: 'private, max-age=300',
    }
  },
  { rateLimit: GRID_THUMBNAILS_RATE_LIMIT },
)
