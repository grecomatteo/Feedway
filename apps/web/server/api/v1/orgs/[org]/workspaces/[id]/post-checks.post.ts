import { checkPost } from '@app/application'
import { postCheckRoute } from '@app/contracts'

export default defineApiRoute(postCheckRoute, async ({ actor, params, body }) => {
  const { shareToFeed, cover, caption, ...rest } = body
  const report = await checkPost(useDeps(), actor, {
    ...rest,
    workspaceId: params.id,
    // `exactOptionalPropertyTypes`: an absent field stays absent
    ...(cover === undefined ? {} : { cover }),
    caption: {
      common: caption.common,
      ...(caption.instagram === undefined ? {} : { instagram: caption.instagram }),
      ...(caption.facebook === undefined ? {} : { facebook: caption.facebook }),
    },
    shareToFeed: shareToFeed ?? true,
  })
  return { ...report, scheduledAt: report.scheduledAt?.toISOString() ?? null }
})
