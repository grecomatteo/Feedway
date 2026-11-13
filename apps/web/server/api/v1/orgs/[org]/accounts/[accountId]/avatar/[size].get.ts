import { readAccountAvatar } from '@app/application'
import { accountAvatarRoute } from '@app/contracts'

// Feedway's copy of an account's picture (plan 04 Task 4): in the panel only, for whoever sees
// the account. Any other case is a 404, as an account without a picture.
export default defineApiRoute(accountAvatarRoute, async ({ actor, params }) => {
  const picture = await readAccountAvatar(useDeps(), actor, {
    accountId: params.accountId,
    size: params.size === '64' ? 64 : 256,
  })
  if (!picture) throw new HttpProblem('NOT_FOUND')
  return {
    body: picture.object.body,
    size: picture.object.size,
    etag: picture.hash,
    cacheControl: 'private, max-age=86400',
  }
})
