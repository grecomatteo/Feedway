import { getGridThumbnail } from '@app/application'
import { calendarGridThumbnailRoute } from '@app/contracts'

// The picture of a post out on Instagram (plan 09 Task 12, P4), from the token the grid gave:
// no call to Meta, a download from its picture hosts at every request, never kept; the browser
// keeps it five minutes. Counted for the person and for the account. Anything else is a 404.
export default defineApiRoute(
  calendarGridThumbnailRoute,
  async ({ actor, params }) => {
    const picture = await getGridThumbnail(
      useDeps(),
      actor,
      { workspaceId: params.id, accountId: params.accountId, picture: params.picture },
      {
        // counted once the token opened and the account is the visible client's
        beforePlatform: () =>
          limitAccount(GRID_ACCOUNT_PICTURES_LIMIT, actor.organizationId, params.accountId),
      },
    )
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
