import { checkPost } from '@app/application'
import { postCheckRoute } from '@app/contracts'

export default defineApiRoute(
  postCheckRoute,
  async ({ actor, params, body }) => {
    const { shareToFeed, cover, caption, ...rest } = body
    const { invalidChoices, ...report } = await checkPost(useDeps(), actor, {
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
    // the engine leaves an orphan choice out (D-54); a request with one is a wrong body
    if (invalidChoices.length > 0)
      throw new HttpProblem('VALIDATION', {
        issues: invalidChoices.map((c) => ({
          path: ['choices', body.choices.findIndex((x) => x.key === c.key)],
          message: INVALID_CHOICE_MESSAGE,
        })),
      })
    return { ...report, scheduledAt: report.scheduledAt?.toISOString() ?? null }
  },
  { rateLimit: POST_CHECKS_RATE_LIMIT },
)
